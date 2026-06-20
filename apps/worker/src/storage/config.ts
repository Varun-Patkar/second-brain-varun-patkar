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

import type { TurnContext } from "../runtime/context.js";
import { listDir, readFile } from "./github.js";

const CONFIG_CACHE_KEY = "config:brain";
const MCP_PATH = "mcp.json";
const SKILLS_DIR = "skills";

/** A remote MCP server the brain can call tools from. */
export interface McpServerConfig {
  /** Stable id; becomes the namespace prefix for the server's tools. */
  id: string;
  /** Remote MCP endpoint URL (HTTP/SSE). */
  url: string;
  /** Whether this server's tools are enabled. Defaults to true. */
  enabled?: boolean;
}

/** A skill loaded from the brain (name + description + full content). */
export interface LoadedSkill {
  name: string;
  description: string;
  content: string;
}

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
      const parsed = JSON.parse(mcpFile.text) as { servers?: McpServerConfig[] };
      config.mcpServers = (parsed.servers ?? []).filter((s) => s.id && s.url);
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
  return `${JSON.stringify({ servers }, null, 2)}\n`;
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

export { EMPTY as EMPTY_BRAIN_CONFIG };
