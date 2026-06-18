/**
 * The consolidator: keeps the brain tidy *only when a turn changed something*, and
 * only over the touched subgraph. Cheap deterministic checks run first; a single
 * LLM call proposes semantic links/trash as a structured plan, which a
 * deterministic validator gates before applying. Risky merges are deferred to the
 * monthly GitHub Actions job. Nothing is ever hard-deleted (trash → `_deleted/`).
 *
 * @packageDocumentation
 */

import { createAgent } from "agent-framework-js/agents";
import type { Provider } from "agent-framework-js/providers";
import type { ConsolidationOp, ConsolidationResult, EdgeType } from "@second-brain/shared";
import type { TurnContext } from "../runtime/context.js";
import { budgetMiddleware } from "../middleware/budget.js";
import { getNodes, upsertEdges, inboundEdgeCount } from "../storage/d1.js";
import { trashNode } from "../storage/writes.js";
import { genId } from "../util/ids.js";

const CONSOLIDATOR_INSTRUCTIONS = `You optimize a personal knowledge wiki. You are given summaries of the nodes that changed this turn.

Propose ONLY safe improvements as a JSON array of operations. Output JSON and nothing else:
[
  { "op": "link", "src": "<id>", "dst": "<id>", "type": "relates_to", "reason": "..." },
  { "op": "trash", "id": "<id>", "reason": "duplicate/empty/obsolete" },
  { "op": "merge", "survivor": "<id>", "absorbed": "<id>", "reason": "near-duplicate" }
]

Rules:
- Only reference ids present in the provided summaries.
- Suggest 'trash' only for clearly empty/duplicate/obsolete nodes.
- Suggest 'merge' only for genuine near-duplicates.
- If nothing should change, output [].`;

function createConsolidatorAgent(ctx: TurnContext, provider: Provider, model?: string) {
  return createAgent({
    name: "consolidator",
    instructions: CONSOLIDATOR_INSTRUCTIONS,
    provider,
    ...(model ? { model } : {}),
    maxIterations: 1,
    middleware: [budgetMiddleware(ctx, "consolidator")],
  });
}

/** Extract a JSON array of ops from a possibly fenced model response. */
function parsePlan(output: string): ConsolidationOp[] {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(output.slice(start, end + 1)) as ConsolidationOp[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Run a consolidation pass over the dirty subgraph. Safe by construction: links
 * are always allowed; trash is gated on (ref_count === 0 && no inbound edges);
 * merges are deferred to the monthly job.
 */
export async function runConsolidation(
  ctx: TurnContext,
  provider: Provider,
  model?: string,
): Promise<ConsolidationResult> {
  const ids = [...ctx.dirty.nodes];
  if (ids.length === 0) return { plan: [], applied: [], deferred: [] };

  ctx.emitTrace({ agent: "consolidator", detail: `consolidating ${ids.length} dirty node(s)` });
  const nodes = await getNodes(ctx, ids);
  if (nodes.length === 0) return { plan: [], applied: [], deferred: [] };

  const summaries = nodes.map((n) => `- ${n.id} [${n.type}] ${n.title}: ${n.summary}`).join("\n");
  const agent = createConsolidatorAgent(ctx, provider, model);
  const res = await agent.run(`Changed nodes:\n${summaries}\n\nReturn the JSON plan.`);
  const plan = parsePlan(res.output);

  const validIds = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const applied: ConsolidationOp[] = [];
  const deferred: ConsolidationOp[] = [];

  for (const op of plan) {
    if (op.op === "link") {
      if (!validIds.has(op.src) || !validIds.has(op.dst) || op.src === op.dst) {
        deferred.push(op);
        continue;
      }
      await upsertEdges(ctx, [
        { id: genId("edge"), src: op.src, dst: op.dst, type: op.type as EdgeType, weight: 1 },
      ]);
      applied.push(op);
    } else if (op.op === "trash") {
      const node = byId.get(op.id);
      const inbound = node ? await inboundEdgeCount(ctx, op.id) : 1;
      if (node && node.refCount === 0 && inbound === 0) {
        await trashNode(ctx, op.id);
        applied.push(op);
      } else {
        deferred.push(op); // unsafe to trash → leave for the monthly job
      }
    } else {
      deferred.push(op); // merges always deferred to the monthly job
    }
  }

  ctx.emitTrace({
    agent: "consolidator",
    detail: `applied ${applied.length}, deferred ${deferred.length}`,
  });
  return { plan, applied, deferred };
}
