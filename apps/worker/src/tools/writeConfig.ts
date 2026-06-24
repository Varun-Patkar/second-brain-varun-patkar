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
import { tracedTool } from "../runtime/toolTrace.js";
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
      "({id, url, enabled, type, headers}); MCP servers MUST be remote HTTPS URLs (stdio is not supported). " +
      "'type' is 'http' (default) or 'sse'. 'headers' is a map of HTTP headers for auth (e.g. {\"x-apikey\": \"...\"}); " +
      "NEVER put a raw secret value in a header — reference a stored secret as '{{secret:NAME}}' instead. Use " +
      "'upsertSkills' to add/update skills ({name, description, content}); 'description' should say WHEN to use the " +
      "skill, and skill content may also reference secrets as '{{secret:NAME}}'. Use 'deleteSkills' to remove skills " +
      "by name. Changes take effect on the next turn.",
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
              type: { type: "string", enum: ["http", "sse"], description: "Wire transport (default http)." },
              headers: {
                type: "object",
                additionalProperties: { type: "string" },
                description: "HTTP headers for auth; reference secrets as {{secret:NAME}}, never raw values.",
              },
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
      return tracedTool(
        ctx,
        "write_config",
        {
          ...(mcpServers ? { mcpServers } : {}),
          ...(upsertSkills ? { upsertSkills: upsertSkills.map((s) => s.name) } : {}),
          ...(deleteSkills ? { deleteSkills } : {}),
        },
        () =>
          applyConfigChanges(ctx, {
            ...(mcpServers ? { mcpServers } : {}),
            ...(upsertSkills ? { upsertSkills } : {}),
            ...(deleteSkills ? { deleteSkills } : {}),
          }),
        (r) => ({ changed: r.changed }),
      );
    },
  });
}
