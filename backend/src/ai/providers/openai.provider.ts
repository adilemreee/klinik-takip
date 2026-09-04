import {
  MAX_IMAGE_BYTES,
  ProviderError,
  type AIMessage,
  type AIProviderName,
  type AIProvider,
  type ContentBlock,
  type FetchLike,
  type ProviderRequest,
  type ProviderResponse,
} from '../ai-provider';
import { parseRetryAfter } from '../retry';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

/**
 * What a provider speaking this protocol differs in.
 *
 * DeepSeek implements OpenAI's API, so it is this class with another base URL.
 * Keeping that a parameter rather than a copy is the point of the seam: two
 * copies of a request body drift, and the one that drifts is the one nobody
 * has a key for in development.
 */
export interface OpenAICompatible {
  endpoint: string;
  /** The name in an error a person reads. */
  label: string;
}

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
  readonly name: AIProviderName = 'openai';

  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike,
    private readonly compatible: OpenAICompatible = { endpoint: ENDPOINT, label: 'OpenAI' },
  ) {}

  async complete(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse> {
    const response = await this.fetchImpl(this.compatible.endpoint, {
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
          ...request.messages.map(toOpenAIMessage),
        ],
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      }),
      signal,
    }).catch((error: unknown) => {
      throw new ProviderError(
        `Could not reach ${this.compatible.label}: ${String(error)}`,
        null,
      );
    });

    const raw = await response.text();

    if (!response.ok) {
      throw new ProviderError(
        `${this.compatible.label} refused the request: ${messageFrom(raw)}`,
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

/** OpenAI takes an image as a data URL. */
function toOpenAIMessage(message: AIMessage): {
  role: string;
  content: string | Record<string, unknown>[];
} {
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content };
  }

  return {
    role: message.role,
    content: message.content.map((block: ContentBlock) => {
      if (block.type === 'text') return { type: 'text', text: block.text };

      // Four base64 characters carry three bytes.
      if ((block.base64.length * 3) / 4 > MAX_IMAGE_BYTES) {
        throw new ProviderError('The image is too large to send', 413);
      }

      return {
        type: 'image_url',
        image_url: { url: `data:${block.mediaType};base64,${block.base64}` },
      };
    }),
  };
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
