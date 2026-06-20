/**
 * `write_config` tool — lets the brain agent edit its own configuration: the
 * remote MCP servers in `mcp.json` and the `skills/<name>.md` knowledge bundles.
 * All changes commit to the `brain` branch in one commit and invalidate the
 * cached config so the next turn picks them up.
 *
 * @packageDocumentation
 */

import { defineTool } from "agent-framework-js/tools";
import type { TurnContext } from "../runtime/context.js";
import { commitBatch } from "../storage/github.js";
import {
  configPaths,
  invalidateBrainConfig,
  serializeMcp,
  serializeSkill,
  type McpServerConfig,
} from "../storage/config.js";

interface WriteConfigArgs {
  /** Full replacement list for `mcp.json` (omit to leave MCP servers unchanged). */
  mcpServers?: McpServerConfig[];
  /** Skills to create or overwrite. */
  upsertSkills?: Array<{ name: string; description: string; content: string }>;
  /** Skill names to delete. */
  deleteSkills?: string[];
}

interface WriteConfigResult {
  commitSha: string;
  changed: string[];
}

export function createWriteConfigTool(ctx: TurnContext) {
  return defineTool<WriteConfigArgs, WriteConfigResult>({
    name: "write_config",
    description:
      "Edit the brain's own configuration. Use 'mcpServers' to replace the full list of remote MCP servers " +
      "({id, url, enabled}); MCP servers MUST be remote HTTPS URLs (stdio is not supported). Use 'upsertSkills' " +
      "to add/update skills ({name, description, content}); 'description' should say WHEN to use the skill. Use " +
      "'deleteSkills' to remove skills by name. Changes take effect on the next turn.",
    inputSchema: {
      type: "object",
      properties: {
        mcpServers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              url: { type: "string", description: "Remote MCP HTTPS endpoint." },
              enabled: { type: "boolean" },
            },
            required: ["id", "url"],
          },
        },
        upsertSkills: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string", description: "When to use this skill (used for relevance)." },
              content: { type: "string", description: "Full skill content (markdown)." },
            },
            required: ["name", "description", "content"],
          },
        },
        deleteSkills: { type: "array", items: { type: "string" } },
      },
    },
    run: async ({ mcpServers, upsertSkills, deleteSkills }) => {
      const writes: Array<{ path: string; content: string }> = [];
      const deletes: string[] = [];
      const changed: string[] = [];

      if (mcpServers) {
        // Guard the runtime constraint: only remote HTTPS servers are usable.
        const cleaned = mcpServers
          .filter((s) => s.id && s.url)
          .map((s) => ({ id: s.id, url: s.url, enabled: s.enabled !== false }));
        writes.push({ path: configPaths.mcp, content: serializeMcp(cleaned) });
        changed.push(configPaths.mcp);
      }

      for (const skill of upsertSkills ?? []) {
        const path = configPaths.skill(skill.name);
        writes.push({ path, content: serializeSkill(skill) });
        changed.push(path);
      }

      for (const name of deleteSkills ?? []) {
        const path = configPaths.skill(name);
        deletes.push(path);
        changed.push(`-${path}`);
      }

      if (writes.length === 0 && deletes.length === 0) {
        return { commitSha: "", changed: [] };
      }

      ctx.emitTrace({ agent: "brain", tool: "write_config", detail: `${changed.length} change(s)` });
      const commitSha = await commitBatch(ctx, {
        message: `brain: update config (${changed.length} change(s))`,
        writes,
        deletes,
      });
      await invalidateBrainConfig(ctx);
      return { commitSha, changed };
    },
  });
}
