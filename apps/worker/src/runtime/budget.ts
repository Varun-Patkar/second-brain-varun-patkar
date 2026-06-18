/**
 * Per-turn subrequest budget tracker.
 *
 * Cloudflare Workers Free allows 50 subrequests per request; every LLM, GitHub,
 * and D1 call is one. We track usage and trip a *soft* cap (checkpoint + resume in
 * the next invocation) well before the *hard* cap (throw) so a turn degrades
 * gracefully instead of being killed by the platform.
 *
 * @packageDocumentation
 */

/** Thrown when the hard subrequest cap is hit mid-turn. */
export class BudgetExceededError extends Error {
  constructor(public readonly used: number) {
    super(`Subrequest budget exceeded (${used})`);
    this.name = "BudgetExceededError";
  }
}

/** Signals the turn should checkpoint and resume in a fresh Worker invocation. */
export class BudgetSoftCapError extends Error {
  constructor(public readonly used: number) {
    super(`Subrequest soft cap reached (${used}); checkpoint and resume`);
    this.name = "BudgetSoftCapError";
  }
}

export class Budget {
  used = 0;
  llmCalls = 0;
  gitCalls = 0;
  d1Calls = 0;

  /**
   * @param softCap subrequest count at which we checkpoint (default 40).
   * @param hardCap subrequest count at which we throw (default 48, under the 50 limit).
   */
  constructor(
    private readonly softCap = 40,
    private readonly hardCap = 48,
  ) {}

  private bump(): void {
    this.used++;
    if (this.used >= this.hardCap) throw new BudgetExceededError(this.used);
  }

  llm(): void {
    this.llmCalls++;
    this.bump();
  }

  git(): void {
    this.gitCalls++;
    this.bump();
  }

  d1(): void {
    this.d1Calls++;
    this.bump();
  }

  /** True once the soft cap is reached; the turn loop should checkpoint. */
  get nearCap(): boolean {
    return this.used >= this.softCap;
  }

  /** Throw the soft-cap signal if we've crossed the threshold. */
  guardSoftCap(): void {
    if (this.nearCap) throw new BudgetSoftCapError(this.used);
  }
}
