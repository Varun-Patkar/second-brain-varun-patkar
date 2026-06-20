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
import { applyConfigChanges, type McpServerConfig } from "../storage/config.js";

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
      const result = await applyConfigChanges(ctx, {
        ...(mcpServers ? { mcpServers } : {}),
        ...(upsertSkills ? { upsertSkills } : {}),
        ...(deleteSkills ? { deleteSkills } : {}),
      });
      if (result.changed.length > 0) {
        ctx.emitTrace({ agent: "brain", tool: "write_config", detail: `${result.changed.length} change(s)` });
      }
      return result;
    },
  });
}
