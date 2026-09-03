import { ProviderError, type AIProvider, type ProviderResponse } from '../ai-provider';

/**
 * The provider in use until a key exists, and the one every environment starts
 * with.
 *
 * It refuses, in the same shape a real failure takes, for the same reason the
 * unconfigured notification senders do: a stub that returned plausible text
 * would put invented clinical content in front of a doctor with a model name
 * and a timestamp on it. There is no safe placeholder for an answer.
 *
 * The refusal is fatal rather than retryable — a missing key does not get
 * better on the second attempt.
 */
export class UnconfiguredProvider implements AIProvider {
  readonly name = 'unconfigured' as const;
  readonly model = 'unconfigured';

  complete(): Promise<ProviderResponse> {
    return Promise.reject(
      new ProviderError('No AI provider is configured', 501),
    );
  }
}
