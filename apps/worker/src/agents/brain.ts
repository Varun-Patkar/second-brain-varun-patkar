/**
 * The brain agent: a single tool-using reasoning loop that plans, retrieves, and
 * edits the wiki. Collapsing the former orchestrator/fetch/edit trio into one loop
 * keeps the per-turn LLM subrequest count roughly linear (see ARCHITECTURE.md §4.2).
 *
 * @packageDocumentation
 */

import { createAgent } from "agent-framework-js/agents";
import type { Provider } from "agent-framework-js/providers";
import type { TurnContext } from "../runtime/context.js";
import { createBrainTools } from "../tools/index.js";
import { budgetMiddleware } from "../middleware/budget.js";

const BRAIN_INSTRUCTIONS = `You maintain a personal knowledge wiki (a "second brain") for a single user.

GROUNDING
- For factual questions, ALWAYS call graph_search FIRST, then read_markdown for at most 5 nodes.
- Never invent node ids — get them from graph_search results.

WRITING
- To store or update knowledge, call write_brain ONCE with ALL writes for this turn (they become a single commit).
- Omit 'id' to create a node; pass an existing id to update it. Keep 'summary' to one line.
- Link related nodes via 'edges' using ids from graph_search.

BUDGET
- You have a strict subrequest budget. Prefer one good search over many reads. Stop as soon as you can answer; do not over-explore.

Answer the user concisely and ground every factual claim in the brain.`;

/** Create the brain agent bound to the current turn context and chosen provider. */
export function createBrainAgent(ctx: TurnContext, provider: Provider, model?: string) {
  return createAgent({
    name: "brain",
    instructions: BRAIN_INSTRUCTIONS,
    provider,
    ...(model ? { model } : {}),
    tools: createBrainTools(ctx),
    maxIterations: 6,
    middleware: [budgetMiddleware(ctx, "brain")],
  });
}
