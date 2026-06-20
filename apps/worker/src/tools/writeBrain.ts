/**
 * `write_brain` tool — the only way the brain agent adds or updates knowledge.
 * All writes in a turn are batched into a single git commit and an idempotent
 * index update.
 *
 * @packageDocumentation
 */

import { defineTool } from "agent-framework-js/tools";
import type { BrainWrite, WriteResult } from "@second-brain/shared";
import type { TurnContext } from "../runtime/context.js";
import { persistWrites } from "../storage/writes.js";

interface WriteArgs {
  writes: BrainWrite[];
}

export function createWriteBrainTool(ctx: TurnContext) {
  return defineTool<WriteArgs, WriteResult>({
    name: "write_brain",
    description:
      "Create or update knowledge nodes. Pass ALL writes for this turn at once (they become one commit). Omit 'id' to create a node; include an existing id to update it. Use ids from graph_search for 'edges.to'. Keep 'summary' to one line.",
    inputSchema: {
      type: "object",
      properties: {
        writes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Existing node id to update; omit to create." },
              type: { type: "string", description: "Node type, e.g. person|project|concept|journal." },
              title: { type: "string" },
              summary: { type: "string", description: "One-line description." },
              body: { type: "string", description: "Full markdown detail." },
              tags: { type: "array", items: { type: "string" } },
              edges: {
                type: "array",
                items: {
                  type: "object",
                  properties: { to: { type: "string" }, type: { type: "string" } },
                  required: ["to", "type"],
                },
              },
            },
            required: ["type", "title", "summary", "body"],
          },
        },
      },
      required: ["writes"],
    },
    run: async ({ writes }) => {
      try {
        const result = await persistWrites(ctx, writes);
        ctx.emitTrace({ agent: "brain", tool: "write_brain", detail: `${writes.length} node(s) → committed` });
        return result;
      } catch (err) {
        ctx.emitTrace({
          agent: "brain",
          tool: "write_brain",
          detail: `${writes.length} node(s) → error: ${err instanceof Error ? err.message : String(err)}`,
        });
        throw err;
      }
    },
  });
}
