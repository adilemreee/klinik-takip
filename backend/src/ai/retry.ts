/**
 * When to try an AI call again, and when trying again is just a slower failure.
 *
 * The distinction matters more here than in most retry code. These calls are
 * slow and paid for: retrying a request the provider will refuse three times
 * spends three times the latency on the same answer, and on a bad API key it
 * turns an instant, obvious misconfiguration into a thirty-second timeout that
 * looks like the model being slow.
 */

export type FailureKind = 'retryable' | 'fatal';

/**
 * Three, matching the queue's own policy.
 *
 * These attempts sit *inside* one queue job, so a job that exhausts them is
 * retried by the queue as well — three fast attempts against a blip, then a
 * slow one much later against an outage.
 */
export const MAX_ATTEMPTS = 3;

/** First backoff step; doubled each attempt. */
export const BASE_DELAY_MS = 1_000;

/**
 * A provider asking us to wait an hour is not a reason to hold a job open for
 * an hour — the queue's own backoff is the right place for a wait that long.
 */
export const MAX_DELAY_MS = 30_000;

export interface Failure {
  /** HTTP status, or null for a transport-level failure. */
  status: number | null;
  /** The provider's `Retry-After`, in seconds, when it sent one. */
  retryAfterSeconds?: number | null;
}

/**
 * A refusal the provider will repeat is fatal; everything transient is not.
 *
 * 408 and 429 are the provider saying "later", 5xx is the provider being
 * broken, and a null status is the network. Everything else — a malformed
 * request, a rejected key, a model name that does not exist, a prompt over the
 * context limit — will fail identically on the next attempt.
 */
export function classify(failure: Failure): FailureKind {
  const { status } = failure;

  if (status === null) return 'retryable';
  if (status === 408 || status === 429) return 'retryable';
  if (status >= 500) return 'retryable';

  return 'fatal';
}

export function shouldRetry(failure: Failure, attempt: number): boolean {
  return attempt < MAX_ATTEMPTS && classify(failure) === 'retryable';
}

/**
 * How long to wait before attempt `attempt + 1`.
 *
 * Full jitter rather than plain exponential backoff: when a provider returns
 * 429 it is usually returning it to every job at once, and a fixed schedule
 * sends the whole batch back in the same instant, which is the thing that
 * caused the 429.
 *
 * A `Retry-After` from the provider is honoured as a floor — it knows when its
 * own limit resets — but capped, because holding a job open for the hour some
 * providers ask for is the queue's decision, not this function's.
 */
export function backoffMs(
  attempt: number,
  failure: Failure = { status: null },
  random: () => number = Math.random,
): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1), MAX_DELAY_MS);
  const jittered = Math.round(random() * exponential);

  const requested = failure.retryAfterSeconds;
  const floor =
    requested !== null && requested !== undefined && Number.isFinite(requested) && requested > 0
      ? Math.min(requested * 1_000, MAX_DELAY_MS)
      : 0;

  return Math.max(floor, jittered);
}

/**
 * `Retry-After` in either of the two forms the header is allowed to take.
 *
 * Providers send both, and reading only the numeric one means silently ignoring
 * the date form and hammering a provider that asked, in writing, to be left
 * alone.
 */
export function parseRetryAfter(
  header: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!header) return null;

  const trimmed = header.trim();
  const seconds = Number(trimmed);

  if (Number.isFinite(seconds)) {
    return seconds >= 0 ? seconds : null;
  }

  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return null;

  const delta = Math.ceil((when - now.getTime()) / 1_000);

  return delta > 0 ? delta : 0;
}
