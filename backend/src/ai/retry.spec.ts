import { backoffMs, classify, parseRetryAfter, shouldRetry, MAX_ATTEMPTS, MAX_DELAY_MS } from './retry';
import { budgetUsedFraction, costUsd, withinBudget } from './cost';

/**
 * Trying again, and knowing when not to.
 *
 * These calls are slow and paid for, so a retry that was never going to work
 * spends real latency on the same failure — and on a bad key it turns an
 * instant, obvious misconfiguration into something that looks like a slow
 * model.
 */
describe('classifying a provider failure', () => {
  it('retries the provider saying "later"', () => {
    expect(classify({ status: 429 })).toBe('retryable');
    expect(classify({ status: 408 })).toBe('retryable');
  });

  it('retries the provider being broken', () => {
    for (const status of [500, 502, 503, 529]) {
      expect(classify({ status })).toBe('retryable');
    }
  });

  it('retries a transport failure, which has no status at all', () => {
    expect(classify({ status: null })).toBe('retryable');
  });

  /** A rejected key, a malformed body or an oversized prompt fail identically. */
  it('gives up on a refusal the provider will repeat', () => {
    for (const status of [400, 401, 403, 404, 413, 422]) {
      expect(classify({ status })).toBe('fatal');
    }
  });

  it('stops after the attempt limit even for a retryable failure', () => {
    expect(shouldRetry({ status: 503 }, MAX_ATTEMPTS - 1)).toBe(true);
    expect(shouldRetry({ status: 503 }, MAX_ATTEMPTS)).toBe(false);
  });

  it('never retries a fatal failure, even on the first attempt', () => {
    expect(shouldRetry({ status: 401 }, 1)).toBe(false);
  });
});

describe('how long to wait', () => {
  /**
   * Full jitter, because a 429 is usually being returned to every job at once
   * and a fixed schedule sends the whole batch back in the same instant — which
   * is what caused the 429.
   */
  it('spreads retries across the window rather than firing them together', () => {
    expect(backoffMs(1, { status: 429 }, () => 0)).toBe(0);
    expect(backoffMs(1, { status: 429 }, () => 1)).toBe(1_000);
    expect(backoffMs(2, { status: 429 }, () => 1)).toBe(2_000);
    expect(backoffMs(3, { status: 429 }, () => 1)).toBe(4_000);
  });

  it('honours a Retry-After as a floor', () => {
    expect(backoffMs(1, { status: 429, retryAfterSeconds: 5 }, () => 0)).toBe(5_000);
  });

  /** Holding a job open for the hour some providers ask for is the queue's call. */
  it('caps a Retry-After that asks for an hour', () => {
    expect(backoffMs(1, { status: 429, retryAfterSeconds: 3_600 }, () => 0)).toBe(MAX_DELAY_MS);
  });

  it('caps the exponential growth too', () => {
    expect(backoffMs(20, { status: 503 }, () => 1)).toBe(MAX_DELAY_MS);
  });
});

describe('reading Retry-After', () => {
  const now = new Date('2026-03-04T12:00:00.000Z');

  it('reads the numeric form', () => {
    expect(parseRetryAfter('30', now)).toBe(30);
  });

  /** Providers send both forms; ignoring the date one hammers a provider that asked in writing to be left alone. */
  it('reads the date form', () => {
    expect(parseRetryAfter('Wed, 04 Mar 2026 12:00:45 GMT', now)).toBe(45);
  });

  it('treats a date already past as no wait', () => {
    expect(parseRetryAfter('Wed, 04 Mar 2026 11:59:00 GMT', now)).toBe(0);
  });

  it('ignores nonsense rather than waiting forever', () => {
    expect(parseRetryAfter('soon', now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('', now)).toBeNull();
  });
});

/**
 * An unbounded AI spend on a clinic budget is a real failure mode, and the
 * numbers here are small enough that rounding decides whether a month costs
 * anything at all on paper.
 */
describe('what a call cost', () => {
  const pricing = { inputPerMillionUsd: 3, outputPerMillionUsd: 15 };

  it('charges input and output separately', () => {
    expect(costUsd({ inputTokens: 1_000_000, outputTokens: 0 }, pricing)).toBe(3);
    expect(costUsd({ inputTokens: 0, outputTokens: 1_000_000 }, pricing)).toBe(15);
    expect(costUsd({ inputTokens: 500_000, outputTokens: 100_000 }, pricing)).toBe(3);
  });

  /**
   * A single call costs a fraction of a cent. Rounding to cents would record
   * almost all of them as zero and make the monthly total a fiction.
   */
  it('keeps a fraction of a cent instead of rounding it to nothing', () => {
    expect(costUsd({ inputTokens: 1_200, outputTokens: 300 }, pricing)).toBe(0.0081);
    expect(costUsd({ inputTokens: 1, outputTokens: 0 }, pricing)).toBe(0.000003);
  });

  it('is free when nothing was used', () => {
    expect(costUsd({ inputTokens: 0, outputTokens: 0 }, pricing)).toBe(0);
  });
});

describe('the monthly budget', () => {
  it('allows a call while there is room', () => {
    expect(withinBudget({ spentUsd: 9.99, budgetUsd: 10 })).toBe(true);
  });

  it('refuses once the cap is reached', () => {
    expect(withinBudget({ spentUsd: 10, budgetUsd: 10 })).toBe(false);
    expect(withinBudget({ spentUsd: 12, budgetUsd: 10 })).toBe(false);
  });

  it('allows everything when the operator set no cap', () => {
    expect(withinBudget({ spentUsd: 1_000, budgetUsd: null })).toBe(true);
    expect(budgetUsedFraction({ spentUsd: 1_000, budgetUsd: null })).toBeNull();
  });

  it('reports how much of the month is gone, never past full', () => {
    expect(budgetUsedFraction({ spentUsd: 2.5, budgetUsd: 10 })).toBe(0.25);
    expect(budgetUsedFraction({ spentUsd: 25, budgetUsd: 10 })).toBe(1);
  });
});
