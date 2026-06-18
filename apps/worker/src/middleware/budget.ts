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
      return next();
    },
  };
}
