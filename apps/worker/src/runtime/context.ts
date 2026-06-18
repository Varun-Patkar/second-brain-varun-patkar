/**
 * Per-turn execution context shared by tools, storage adapters, and the provider
 * middleware. Carries the environment bindings, the subrequest budget, a trace
 * sink for the UI, and the "dirty" set that drives conditional consolidation.
 *
 * @packageDocumentation
 */

import type { TraceEvent } from "@second-brain/shared";
import type { Env } from "../env.js";
import { Budget } from "./budget.js";

/** Tracks whether the turn changed anything and which nodes were touched. */
export interface DirtyState {
  value: boolean;
  nodes: Set<string>;
}

export interface TurnContext {
  env: Env;
  budget: Budget;
  /** Emit a trace event to the frontend (best-effort; never throws). */
  emitTrace: (event: Omit<TraceEvent, "at">) => void;
  dirty: DirtyState;
}

/** Create a fresh turn context. */
export function createTurnContext(
  env: Env,
  emitTrace: (event: Omit<TraceEvent, "at">) => void,
): TurnContext {
  return {
    env,
    budget: new Budget(),
    emitTrace,
    dirty: { value: false, nodes: new Set<string>() },
  };
}

/** Mark a node as touched this turn (drives the consolidator). */
export function markDirty(ctx: TurnContext, ...nodeIds: string[]): void {
  ctx.dirty.value = true;
  for (const id of nodeIds) ctx.dirty.nodes.add(id);
}
