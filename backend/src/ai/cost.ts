/**
 * What a call cost (spec section 3.4: cost and token accounting is mandatory).
 *
 * **There is no price table in this file, and that is the design.** Model
 * prices change, differ per account, and are the one number the operator can
 * read off an invoice and we cannot. A table shipped in the repository would be
 * out of date within a quarter and would be believed anyway, which is worse
 * than no number at all: a budget enforced against stale prices reports a
 * comfortable spend on an uncomfortable bill.
 *
 * So the two prices are configuration, they are required whenever the AI layer
 * is switched on, and the accounting is exact by construction.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface Pricing {
  /** USD per million input tokens. */
  inputPerMillionUsd: number;
  /** USD per million output tokens. */
  outputPerMillionUsd: number;
}

/**
 * Six decimal places, matching `ai_jobs.cost_usd`.
 *
 * A single call can cost a fraction of a cent; rounding to cents would record
 * most of them as zero and make the monthly total meaningless.
 */
const SCALE = 1_000_000;

export function costUsd(usage: TokenUsage, pricing: Pricing): number {
  const input = (usage.inputTokens / 1_000_000) * pricing.inputPerMillionUsd;
  const output = (usage.outputTokens / 1_000_000) * pricing.outputPerMillionUsd;

  return Math.round((input + output) * SCALE) / SCALE;
}

export interface BudgetState {
  /** What the current month has cost so far. */
  spentUsd: number;
  /** The cap, or null when the operator set none. */
  budgetUsd: number | null;
}

/**
 * Whether a call may start.
 *
 * Checked before the call rather than after, and against the spend *already
 * recorded* — the cost of the call about to be made is not known until it
 * returns. A single call can therefore cross the line, which is accepted: the
 * alternative is estimating a cost from a prompt and refusing on a guess.
 */
export function withinBudget(state: BudgetState): boolean {
  if (state.budgetUsd === null) return true;

  return state.spentUsd < state.budgetUsd;
}

/** For the usage panel: how much of the month's budget is gone. */
export function budgetUsedFraction(state: BudgetState): number | null {
  if (state.budgetUsd === null || state.budgetUsd <= 0) return null;

  return Math.min(1, state.spentUsd / state.budgetUsd);
}
