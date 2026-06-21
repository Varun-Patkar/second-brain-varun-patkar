/**
 * Budget middleware: charges one LLM subrequest per provider call, emits a trace
 * event, and trips the soft cap *before* making a call that would risk the hard
 * limit — breaking the agent loop so the turn can checkpoint and resume.
 *
 * @packageDocumentation
 */

import type { Middleware } from "agent-framework-js/middleware";
import type { TurnContext } from "../runtime/context.js";
import { BudgetSoftCapError } from "../runtime/budget.js";

/** Build a budget-counting middleware bound to the current turn context. */
export function budgetMiddleware(ctx: TurnContext, agent: "brain" | "consolidator"): Middleware {
  return {
    name: "budget",
    async handle(c, next) {
      // Stop before spending a subrequest we can't afford → checkpoint upstream.
      if (ctx.budget.nearCap) throw new BudgetSoftCapError(ctx.budget.used);
      ctx.budget.llm();
      ctx.emitTrace({ agent, tool: "llm", detail: `model call (${c.request.model ?? "default"})` });
      const res = await next();
      // Capture framework-native token usage (if the provider reported it). `input`
      // is the prompt/context size of this call (track the peak); `output` accrues.
      const usage = res.usage;
      if (usage) {
        if (typeof usage.inputTokens === "number") {
          ctx.tokens.input = Math.max(ctx.tokens.input, usage.inputTokens);
        }
        if (typeof usage.outputTokens === "number") {
          ctx.tokens.output += usage.outputTokens;
        }
        // Push a live metrics update so the UI's token meter moves during the turn.
        ctx.emitMetrics?.();
      }
      return res;
    },
  };
}
