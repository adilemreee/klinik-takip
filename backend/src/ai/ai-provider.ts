import type { TokenUsage } from './cost';

/**
 * The seam the specification asks for (section 3.4): the provider is
 * swappable, so nothing above this line knows whether it is talking to
 * Anthropic or OpenAI.
 *
 * It is deliberately narrow. A thin interface is what makes it swappable — the
 * moment a caller reaches for something only one provider has, the abstraction
 * has become a description of that provider. Everything that is not "send these
 * messages, get text and a token count back" lives above this line instead:
 * pseudonymisation, the budget, retries, the audit trail.
 */

export type AIProviderName = 'anthropic' | 'openai' | 'unconfigured';

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProviderRequest {
  /** Instructions, separate from the conversation, as both providers expect. */
  system: string;
  messages: AIMessage[];
  maxOutputTokens: number;
  temperature?: number;
}

export interface ProviderResponse {
  text: string;
  /** As the provider reported it — the exact version that answered. */
  model: string;
  usage: TokenUsage;
  /** `end_turn`, `max_tokens`, `stop`, `length`… provider wording, unchanged. */
  stopReason: string | null;
}

/**
 * A failure with the two things the retry policy needs, and nothing the log
 * should not have.
 *
 * The message is truncated because provider error bodies sometimes quote the
 * offending request back — which, for this system, means quoting a clinical
 * prompt into a log that is kept for weeks.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message.slice(0, 300));
    this.name = 'ProviderError';
  }
}

export interface AIProvider {
  readonly name: AIProviderName;
  /** The model this provider was configured with. */
  readonly model: string;

  /**
   * The signal is not optional: an AI call with no deadline is a request
   * handler that never returns.
   */
  complete(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse>;
}

/** Injected so a provider can be tested without a network or a key. */
export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;
