/**
 * Turn orchestration: run the brain agent (streamed), then conditionally run the
 * consolidator over the touched subgraph, emitting SSE events throughout. Budget
 * soft-caps surface as a graceful partial; auth failures surface loudly.
 *
 * @packageDocumentation
 */

import type { ChatTurnRequest, TraceEvent, TurnMetrics, TurnStreamEvent } from "@second-brain/shared";
import type { Env } from "./env.js";
import { createTurnContext } from "./runtime/context.js";
import { BudgetExceededError, BudgetSoftCapError } from "./runtime/budget.js";
import { buildProvider } from "./providers/index.js";
import { createBrainAgent } from "./agents/brain.js";
import { runConsolidation } from "./agents/consolidator.js";
import { nowIso } from "./util/ids.js";
import { redact } from "./middleware/redaction.js";

type Emit = (event: TurnStreamEvent) => void;

function metricsOf(ctx: ReturnType<typeof createTurnContext>): TurnMetrics {
  return {
    subrequestsUsed: ctx.budget.used,
    llmCalls: ctx.budget.llmCalls,
    gitCalls: ctx.budget.gitCalls,
    d1Calls: ctx.budget.d1Calls,
    dirtySetSize: ctx.dirty.nodes.size,
  };
}

/** Heuristic: does this error look like an expired/invalid Copilot token? */
function isAuthError(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return m.includes("401") || m.includes("unauthor") || m.includes("invalid token") || m.includes("expired");
}

/** Run one chat turn, emitting SSE events via `emit`. */
export async function runTurn(env: Env, req: ChatTurnRequest, emit: Emit): Promise<void> {
  const ctx = createTurnContext(env, (e) => {
    const event: TraceEvent = { ...e, at: nowIso() };
    emit({ type: "trace", event });
  });

  try {
    const { provider, model } = buildProvider(env, req);
    const brain = createBrainAgent(ctx, provider, model);

    for await (const chunk of brain.runStream(req.message)) {
      if (chunk.type === "text") emit({ type: "text", text: chunk.text });
      else if (chunk.type === "reasoning") emit({ type: "reasoning", text: chunk.text });
      // 'done' carries the final RunResult; metrics are emitted below.
    }

    // Mandatory-but-conditional consolidation: only when the turn changed something.
    if (ctx.dirty.value) {
      try {
        await runConsolidation(ctx, provider, model);
      } catch (consErr) {
        // The user's write already committed (outbox); a stale index is healed by
        // the monthly reconcile. Never fail the turn on consolidation error.
        emit({
          type: "trace",
          event: {
            agent: "consolidator",
            detail: `skipped: ${redact(env, consErr instanceof Error ? consErr.message : String(consErr))}`,
            at: nowIso(),
          },
        });
      }
    }

    emit({ type: "metrics", metrics: metricsOf(ctx) });
    emit({ type: "done", metrics: metricsOf(ctx) });
  } catch (err) {
    if (err instanceof BudgetSoftCapError || err instanceof BudgetExceededError) {
      // Graceful partial — a full resume protocol is a follow-up (see ARCHITECTURE §9).
      emit({ type: "partial", resumeToken: "", metrics: metricsOf(ctx) });
      emit({ type: "done", metrics: metricsOf(ctx) });
      return;
    }
    const message =
      req.provider === "copilot" && isAuthError(err)
        ? "Copilot token expired or invalid — refresh COPILOT_TOKEN on the worker."
        : redact(env, err instanceof Error ? err.message : String(err));
    emit({ type: "error", code: isAuthError(err) ? "auth" : "turn_failed", message });
  }
}
