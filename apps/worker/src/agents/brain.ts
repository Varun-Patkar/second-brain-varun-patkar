/**
 * The brain agent: a single tool-using reasoning loop that plans, retrieves, and
 * edits the wiki. Collapsing the former orchestrator/fetch/edit trio into one loop
 * keeps the per-turn LLM subrequest count roughly linear (see ARCHITECTURE.md §4.2).
 *
 * @packageDocumentation
 */

import { createAgent } from "agent-framework-js/agents";
import type { Provider } from "agent-framework-js/providers";
import type { Tool } from "agent-framework-js/tools";
import { defineSkill, type Skill } from "agent-framework-js/skills";
import type { TurnContext } from "../runtime/context.js";
import { createBrainTools } from "../tools/index.js";
import { budgetMiddleware } from "../middleware/budget.js";
import type { LoadedSkill } from "../storage/config.js";

const BRAIN_INSTRUCTIONS = `You maintain a personal knowledge wiki (a "second brain") for a single user. Every
durable fact lives as a NODE: one markdown file + one indexed row. Your job each turn is to
JUDGE what is worth keeping, CLASSIFY it, and STORE it so it is easy to retrieve later.

GROUNDING (retrieval)
- For factual questions, ALWAYS call graph_search FIRST, then read_markdown for at most 5 nodes.
- Never invent node ids — get them from graph_search results.

STEP 1 — JUDGE (is it worth storing?)
- STORE durable, reusable knowledge: facts about the user, people, projects, concepts, decisions,
  preferences, events, definitions, how-tos, and anything they say to "remember".
- DO NOT store: greetings, chit-chat, transient questions, things already captured (search first),
  or anything the user asks you not to keep. When unsure but it looks durable, prefer storing.

STEP 2 — CLASSIFY (turn it into a well-formed node)
- Pick a 'type': person | project | concept | journal — or a sensible new lowercase type
  (e.g. 'preference', 'decision', 'event', 'task') when none fit. Be consistent with existing types.
- 'title': short and specific. 'summary': ONE retrieval-friendly line. 'body': full markdown detail.
- 'tags': a few lowercase keywords that aid search (title + summary + tags are the FTS index).
- 'edges': connect to related nodes (ids from graph_search) using a relationship type:
  relates_to | part_of | mentions | depends_on | authored_by. Link people↔projects↔concepts so the
  graph stays navigable.
- Split distinct subjects into SEPARATE nodes (one person, one project, one concept each) rather
  than one giant note — small linked nodes retrieve far better.

STEP 3 — STORE (write once)
- BEFORE writing, graph_search for an existing node to UPDATE (e.g. the owner's profile) so you
  never create duplicates.
- Call write_brain ONCE with ALL nodes for this turn (they become a single commit). Omit 'id' to
  create; pass an existing id to update. Briefly confirm what you saved and how it was classified.
- To DELETE a note the user no longer wants, call trash_note with its id (from graph_search). It is
  recoverable from trash; confirm before deleting if the intent is unclear.
- Example: "Hi, I'm Varun, I build X and prefer Y" → a 'person' node for the owner (bio in body),
  optionally a 'project' node for X linked via authored_by, and a 'preference' node for Y.

BUDGET
- You have a strict subrequest budget. Prefer one good search over many reads. Stop as soon as you
  can answer; do not over-explore.

COMPLETE THE TASK
- Carry the task through to completion in THIS turn. If you intend to save something, actually call
  write_brain before you finish — do not say you'll save it and then stop.
- If a tool returns an error, read it, then retry sensibly or adjust; only if it still fails should
  you tell the user the specific error. Never end by asking the user to "try again" for something you
  can do yourself.

Answer the user concisely. Ground every factual claim in the brain, and confirm anything you saved.`;

/** Options for the brain agent: extra (MCP) tools and brain-defined skills. */
export interface BrainAgentOptions {
  /** Tools discovered from configured MCP servers, exposed alongside the core tools. */
  extraTools?: Tool[];
  /** Skills loaded from the brain's `skills/` folder (progressive disclosure). */
  skills?: LoadedSkill[];
}

/** Create the brain agent bound to the current turn context and chosen provider. */
export function createBrainAgent(
  ctx: TurnContext,
  provider: Provider,
  model?: string,
  options: BrainAgentOptions = {},
) {
  const skills: Skill[] = (options.skills ?? []).map((s) =>
    defineSkill({
      name: s.name,
      description: s.description,
      sources: [{ kind: "inline", content: s.content }],
    }),
  );
  const tools = [...createBrainTools(ctx), ...(options.extraTools ?? [])];
  // Record how many tools/skills are active so the UI can surface the counts.
  ctx.counts = { tools: tools.length, skills: skills.length };
  return createAgent({
    name: "brain",
    instructions: BRAIN_INSTRUCTIONS,
    provider,
    ...(model ? { model } : {}),
    tools,
    ...(skills.length > 0 ? { skills } : {}),
    maxIterations: 10,
    middleware: [budgetMiddleware(ctx, "brain")],
  });
}
