/**
 * Per-turn execution context shared by tools, storage adapters, and the provider
 * middleware. Carries the environment bindings, the subrequest budget, a trace
 * sink for the UI, and the "dirty" set that drives conditional consolidation.
 *
 * @packageDocumentation
 */

import type { ToolCall, TraceEvent } from "@second-brain/shared";
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
  /** Emit a structured tool-call event (start/result) for inline rendering. */
  emitTool?: (call: ToolCall) => void;
  /** Emit the current turn metrics live (set by the turn orchestrator). */
  emitMetrics?: () => void;
  dirty: DirtyState;
  /** How many tools / skills are active this turn (surfaced in metrics). */
  counts: { tools: number; skills: number };
  /**
   * Framework-reported token usage for this turn. `input` tracks the largest
   * prompt (context-window) size seen, `output` accumulates generated tokens.
   */
  tokens: { input: number; output: number };
  /** The selected model's max input tokens (context window); drives the UI meter. */
  tokenLimit?: number;
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
    counts: { tools: 0, skills: 0 },
    tokens: { input: 0, output: 0 },
  };
}

/** Mark a node as touched this turn (drives the consolidator). */
export function markDirty(ctx: TurnContext, ...nodeIds: string[]): void {
  ctx.dirty.value = true;
  for (const id of nodeIds) ctx.dirty.nodes.add(id);
}
