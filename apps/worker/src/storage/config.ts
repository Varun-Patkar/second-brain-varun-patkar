/**
 * Brain configuration: MCP server connections and skills, both stored on the
 * `brain` branch and editable by the agent (see the `write_config` tool).
 *
 * - `mcp.json` (repo root) lists remote MCP servers to expose as tools. Only
 *   `remote` (HTTP/SSE) transports are usable from the Worker runtime — stdio
 *   requires process spawning and is intentionally unsupported here.
 * - `skills/<name>.md` files are domain-knowledge bundles. Each carries a tiny
 *   frontmatter (`name`, `description`); the body is the skill content, loaded
 *   into the agent only when its description matches the prompt (progressive
 *   disclosure handled by the framework's SkillIndex).
 *
 * The assembled config is cached in KV (not counted against the subrequest
 * budget) and invalidated whenever the agent edits it, so steady-state turns pay
 * zero git reads for config.
 *
 * @packageDocumentation
 */

import type {
  BrainConfigUpdate,
  BrainConfigUpdateResult,
  BrainSkill,
  McpServerConfig,
} from "@second-brain/shared";
import type { TurnContext } from "../runtime/context.js";
import { commitBatch, listDir, readFile } from "./github.js";

const CONFIG_CACHE_KEY = "config:brain";
const MCP_PATH = "mcp.json";
const SKILLS_DIR = "skills";

/** Re-exported wire types so worker modules can import them from one place. */
export type { McpServerConfig, BrainSkill } from "@second-brain/shared";

/** A skill loaded from the brain (alias of the shared wire type). */
export type LoadedSkill = BrainSkill;

/** The assembled, cacheable brain configuration. */
export interface BrainConfig {
  mcpServers: McpServerConfig[];
  skills: LoadedSkill[];
}

const EMPTY: BrainConfig = { mcpServers: [], skills: [] };

/** Parse a skill markdown file with `---\nname:\ndescription:\n---` frontmatter. */
function parseSkill(path: string, raw: string): LoadedSkill | null {
  const fallbackName = path.split("/").pop()?.replace(/\.md$/, "") ?? "skill";
  const text = raw.replace(/^\uFEFF/, "");
  let name = fallbackName;
  let description = "";
  let body = text;
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) {
      const header = text.slice(3, end);
      body = text.slice(end + 4).replace(/^\n+/, "");
      for (const line of header.split("\n")) {
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
        if (key === "name") name = value || fallbackName;
        if (key === "description") description = value;
      }
    }
  }
  if (!body.trim()) return null;
  return { name, description: description || name, content: body };
}

/**
 * Normalize one raw MCP entry into a clean {@link McpServerConfig}, keeping only
 * the supported fields. `id` may come from the entry itself or (for object-map
 * formats) from the map key.
 */
function normalizeMcpEntry(id: string, raw: unknown): McpServerConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const url = typeof r.url === "string" ? r.url : "";
  const finalId = (typeof r.id === "string" && r.id) || id;
  if (!finalId || !url) return null;
  const out: McpServerConfig = { id: finalId, url, enabled: r.enabled !== false };
  if (r.type === "http" || r.type === "sse") out.type = r.type;
  if (r.headers && typeof r.headers === "object") {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.headers as Record<string, unknown>)) {
      if (typeof v === "string") headers[k] = v;
    }
    if (Object.keys(headers).length > 0) out.headers = headers;
  }
  return out;
}

/**
 * Parse the `mcp.json` document, tolerating the three shapes a human or the agent
 * might write: the internal array form (`{ servers: [{ id, url, … }] }`), an
 * object-map under `servers` (`{ servers: { id: { url, … } } }`), and the
 * standard `mcp.json` map (`{ mcpServers: { id: { url, … } } }`).
 */
function parseMcpDocument(text: string): McpServerConfig[] {
  const doc = JSON.parse(text) as Record<string, unknown>;
  const source = doc.servers ?? doc.mcpServers;
  const out: McpServerConfig[] = [];
  if (Array.isArray(source)) {
    for (const entry of source) {
      const cfg = normalizeMcpEntry("", entry);
      if (cfg) out.push(cfg);
    }
  } else if (source && typeof source === "object") {
    for (const [id, entry] of Object.entries(source as Record<string, unknown>)) {
      const cfg = normalizeMcpEntry(id, entry);
      if (cfg) out.push(cfg);
    }
  }
  return out;
}

/**
 * Load the brain config (MCP servers + skills), preferring the KV cache. On a
 * cache miss it reads `mcp.json` and the `skills/` directory from git, charging
 * the per-turn budget for those reads, then caches the assembled result.
 */
export async function loadBrainConfig(ctx: TurnContext): Promise<BrainConfig> {
  const cached = await ctx.env.CACHE.get(CONFIG_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as BrainConfig;
    } catch {
      /* fall through and rebuild */
    }
  }

  const config: BrainConfig = { mcpServers: [], skills: [] };

  // MCP servers (optional file).
  try {
    const mcpFile = await readFile(ctx, MCP_PATH);
    if (mcpFile) {
      config.mcpServers = parseMcpDocument(mcpFile.text);
    }
  } catch (err) {
    ctx.emitTrace({ agent: "brain", detail: `mcp.json ignored: ${(err as Error).message}` });
  }

  // Skills (optional directory).
  try {
    const paths = (await listDir(ctx, SKILLS_DIR)).filter((p) => p.endsWith(".md"));
    for (const p of paths) {
      const file = await readFile(ctx, p);
      if (!file) continue;
      const skill = parseSkill(p, file.text);
      if (skill) config.skills.push(skill);
    }
  } catch (err) {
    ctx.emitTrace({ agent: "brain", detail: `skills ignored: ${(err as Error).message}` });
  }

  await ctx.env.CACHE.put(CONFIG_CACHE_KEY, JSON.stringify(config));
  return config;
}

/** Drop the cached brain config (called after the agent edits it). */
export async function invalidateBrainConfig(ctx: TurnContext): Promise<void> {
  await ctx.env.CACHE.delete(CONFIG_CACHE_KEY);
}

/** Serialize an MCP server list back to the `mcp.json` wire format. */
export function serializeMcp(servers: McpServerConfig[]): string {
  const cleaned = servers.map((s) => ({
    id: s.id,
    url: s.url,
    enabled: s.enabled !== false,
    ...(s.type ? { type: s.type } : {}),
    ...(s.headers && Object.keys(s.headers).length > 0 ? { headers: s.headers } : {}),
  }));
  return `${JSON.stringify({ servers: cleaned }, null, 2)}\n`;
}

/** Build the markdown content for a skill file. */
export function serializeSkill(skill: LoadedSkill): string {
  return `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.content.trimStart()}\n`;
}

/** Path helpers for the config files. */
export const configPaths = {
  mcp: MCP_PATH,
  skill: (name: string): string => `${SKILLS_DIR}/${name.replace(/[^a-z0-9._-]/gi, "-")}.md`,
};

/**
 * Apply a config edit (replace MCP servers, upsert/delete skills) as a single
 * commit on the `brain` branch, then invalidate the cached config. Shared by the
 * agent's `write_config` tool and the UI's `POST /config` route so both paths
 * behave identically. MCP servers are constrained to remote HTTPS endpoints.
 */
export async function applyConfigChanges(
  ctx: TurnContext,
  update: BrainConfigUpdate,
): Promise<BrainConfigUpdateResult> {
  const writes: Array<{ path: string; content: string }> = [];
  const deletes: string[] = [];
  const changed: string[] = [];

  if (update.mcpServers) {
    const cleaned = update.mcpServers
      .filter((s) => s.id && s.url)
      .map((s) => ({
        id: s.id,
        url: s.url,
        enabled: s.enabled !== false,
        ...(s.type ? { type: s.type } : {}),
        ...(s.headers && Object.keys(s.headers).length > 0 ? { headers: s.headers } : {}),
      }));
    writes.push({ path: MCP_PATH, content: serializeMcp(cleaned) });
    changed.push(MCP_PATH);
  }

  for (const skill of update.upsertSkills ?? []) {
    const path = configPaths.skill(skill.name);
    writes.push({ path, content: serializeSkill(skill) });
    changed.push(path);
  }

  for (const name of update.deleteSkills ?? []) {
    deletes.push(configPaths.skill(name));
    changed.push(`-${configPaths.skill(name)}`);
  }

  if (writes.length === 0 && deletes.length === 0) {
    return { commitSha: "", changed: [] };
  }

  const commitSha = await commitBatch(ctx, {
    message: `brain: update config (${changed.length} change(s))`,
    writes,
    deletes,
  });
  await invalidateBrainConfig(ctx);
  return { commitSha, changed };
}

export { EMPTY as EMPTY_BRAIN_CONFIG };
