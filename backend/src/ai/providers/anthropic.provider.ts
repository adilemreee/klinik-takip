import {
  ProviderError,
  type AIProvider,
  type FetchLike,
  type ProviderRequest,
  type ProviderResponse,
} from '../ai-provider';
import { parseRetryAfter } from '../retry';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

/**
 * Pinned rather than tracking the latest.
 *
 * The version header is what keeps a provider-side change from silently
 * altering the shape this parser depends on. Moving it is a decision someone
 * makes and tests, not something that happens on a Tuesday.
 */
const API_VERSION = '2023-06-01';

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  model?: string;
  content?: AnthropicContentBlock[];
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

/**
 * Called through an injected fetch so the request shape can be tested exactly —
 * including that the key never appears anywhere but the header.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic' as const;

  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike,
  ) {}

  async complete(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse> {
    const response = await this.fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxOutputTokens,
        system: request.system,
        messages: request.messages,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      }),
      signal,
    }).catch((error: unknown) => {
      // A transport failure has no status, which is what marks it retryable.
      throw new ProviderError(`Could not reach Anthropic: ${String(error)}`, null);
    });

    const raw = await response.text();

    if (!response.ok) {
      throw new ProviderError(
        `Anthropic refused the request: ${messageFrom(raw)}`,
        response.status,
        parseRetryAfter(response.headers.get('retry-after')),
      );
    }

    const body = parse(raw);

    // Text blocks joined, non-text blocks dropped: a response carrying anything
    // else is one this system has no use for, and quietly rendering it as an
    // empty answer is worse than reporting nothing came back.
    const text = (body.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text!)
      .join('');

    return {
      text,
      model: body.model ?? this.model,
      usage: {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
      },
      stopReason: body.stop_reason ?? null,
    };
  }
}

function parse(raw: string): AnthropicResponse {
  try {
    return JSON.parse(raw) as AnthropicResponse;
  } catch {
    // Unparseable success is a provider or proxy problem, and retrying it is
    // reasonable — but the body is not echoed, because it is not known to be
    // free of the prompt.
    throw new ProviderError('Anthropic returned a body that is not JSON', null);
  }
}

function messageFrom(raw: string): string {
  try {
    return (JSON.parse(raw) as AnthropicResponse).error?.message ?? 'no message';
  } catch {
    return 'no message';
  }
}
