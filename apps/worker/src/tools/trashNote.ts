/**
 * `trash_note` tool — lets the brain agent delete a note. The markdown is moved to
 * `_deleted/` (recoverable from git) and the node is dropped from D1/FTS, so it no
 * longer surfaces in search or context. Links from other notes to this one are
 * removed; the agent is told how many, so it can mention/repair them if needed.
 *
 * @packageDocumentation
 */

import { defineTool } from "agent-framework-js/tools";
import type { TurnContext } from "../runtime/context.js";
import { tracedTool } from "../runtime/toolTrace.js";
import { trashNode } from "../storage/writes.js";
import { inboundEdgeCount } from "../storage/d1.js";

interface TrashArgs {
  id: string;
}

interface TrashResult {
  ok: boolean;
  movedTo?: string;
  /** Number of inbound links removed (other notes that referenced this one). */
  linksRemoved?: number;
  reason?: string;
}

export function createTrashNoteTool(ctx: TurnContext) {
  return defineTool<TrashArgs, TrashResult>({
    name: "trash_note",
    description:
      "Delete a note by id (obtained from graph_search). The markdown is moved to _deleted/ " +
      "(recoverable from git) and the node is removed from the index. Links from other notes to this " +
      "one are dropped. Only delete when the user clearly wants the note removed.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Node id to delete." } },
      required: ["id"],
    },
    run: async ({ id }) =>
      tracedTool(
        ctx,
        "trash_note",
        { id },
        async (): Promise<TrashResult> => {
          const linksRemoved = await inboundEdgeCount(ctx, id);
          const res = await trashNode(ctx, id);
          if (!res) return { ok: false, reason: "No note found with that id." };
          return { ok: true, movedTo: res.movedTo, linksRemoved };
        },
        (r) => r,
      ),
  });
}
