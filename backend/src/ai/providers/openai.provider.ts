import {
  ProviderError,
  type AIProvider,
  type FetchLike,
  type ProviderRequest,
  type ProviderResponse,
} from '../ai-provider';
import { parseRetryAfter } from '../retry';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

interface OpenAIResponse {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/**
 * The second provider, and the reason the interface exists.
 *
 * Its differences from Anthropic are all here and nowhere else: the system
 * prompt is a message rather than a field, the key goes in `Authorization`, and
 * the token counts have different names. That list being short is the evidence
 * the seam is in the right place.
 */
export class OpenAIProvider implements AIProvider {
  readonly name = 'openai' as const;

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
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_completion_tokens: request.maxOutputTokens,
        messages: [
          { role: 'system', content: request.system },
          ...request.messages,
        ],
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      }),
      signal,
    }).catch((error: unknown) => {
      throw new ProviderError(`Could not reach OpenAI: ${String(error)}`, null);
    });

    const raw = await response.text();

    if (!response.ok) {
      throw new ProviderError(
        `OpenAI refused the request: ${messageFrom(raw)}`,
        response.status,
        parseRetryAfter(response.headers.get('retry-after')),
      );
    }

    const body = parse(raw);
    const choice = body.choices?.[0];

    return {
      text: choice?.message?.content ?? '',
      model: body.model ?? this.model,
      usage: {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
      },
      stopReason: choice?.finish_reason ?? null,
    };
  }
}

function parse(raw: string): OpenAIResponse {
  try {
    return JSON.parse(raw) as OpenAIResponse;
  } catch {
    throw new ProviderError('OpenAI returned a body that is not JSON', null);
  }
}

function messageFrom(raw: string): string {
  try {
    return (JSON.parse(raw) as OpenAIResponse).error?.message ?? 'no message';
  } catch {
    return 'no message';
  }
}
