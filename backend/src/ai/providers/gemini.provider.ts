import {
  MAX_IMAGE_BYTES,
  ProviderError,
  type AIMessage,
  type AIProvider,
  type ContentBlock,
  type FetchLike,
  type ProviderRequest,
  type ProviderResponse,
} from '../ai-provider';
import { parseRetryAfter } from '../retry';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string | null;
  }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
  error?: { message?: string };
}

/**
 * Google's Gemini.
 *
 * The third shape, and the one that differs most: the system prompt is its own
 * `systemInstruction` object, a conversation is `contents` with `parts` rather
 * than `content`, the assistant's role is called `model`, and the token counts
 * live under `usageMetadata`. All of that is here and nowhere else, which is
 * what the seam is for.
 *
 * The key goes in a header rather than the query string — a URL travels into
 * proxy logs and error reports, and an API key in one of those is an API key
 * that has to be rotated.
 */
export class GeminiProvider implements AIProvider {
  readonly name = 'gemini' as const;

  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike,
  ) {}

  async complete(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse> {
    const response = await this.fetchImpl(
      `${BASE}/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: request.messages.map(toGeminiContent),
          generationConfig: {
            maxOutputTokens: request.maxOutputTokens,
            ...(request.temperature === undefined
              ? {}
              : { temperature: request.temperature }),
          },
        }),
        signal,
      },
    ).catch((error: unknown) => {
      throw new ProviderError(`Could not reach Gemini: ${String(error)}`, null);
    });

    const raw = await response.text();

    if (!response.ok) {
      throw new ProviderError(
        `Gemini refused the request: ${messageFrom(raw)}`,
        response.status,
        parseRetryAfter(response.headers.get('retry-after')),
      );
    }

    const body = parse(raw);
    const candidate = body.candidates?.[0];

    // Gemini answers 200 with no candidate when its safety filters block the
    // request. Treated as a failure rather than as an empty answer: an empty
    // clinical summary that looks like a successful one is worse than an error.
    if (!candidate) {
      throw new ProviderError('Gemini returned no candidate', response.status);
    }

    const text = (candidate.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('');

    return {
      text,
      model: body.modelVersion ?? this.model,
      usage: {
        inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
      },
      stopReason: candidate.finishReason ?? null,
    };
  }
}

/** Gemini calls the assistant "model" and wraps everything in `parts`. */
function toGeminiContent(message: AIMessage): {
  role: string;
  parts: Record<string, unknown>[];
} {
  const role = message.role === 'assistant' ? 'model' : 'user';

  if (typeof message.content === 'string') {
    return { role, parts: [{ text: message.content }] };
  }

  return { role, parts: message.content.map(toGeminiPart) };
}

function toGeminiPart(block: ContentBlock): Record<string, unknown> {
  if (block.type === 'text') return { text: block.text };

  // The same backstop as the other providers: finding out from a 400 after
  // uploading four megabytes is slower and costs the upload.
  if (Buffer.byteLength(block.base64, 'base64') > MAX_IMAGE_BYTES) {
    throw new ProviderError('Image is too large to send', null);
  }

  return { inlineData: { mimeType: block.mediaType, data: block.base64 } };
}

function parse(raw: string): GeminiResponse {
  try {
    return JSON.parse(raw) as GeminiResponse;
  } catch {
    throw new ProviderError('Gemini returned something that is not JSON', null);
  }
}

/**
 * The provider's own words, truncated.
 *
 * Error bodies sometimes quote the offending request back, which for this
 * system means quoting a clinical prompt into a log kept for weeks.
 */
function messageFrom(raw: string): string {
  try {
    return (JSON.parse(raw) as GeminiResponse).error?.message ?? raw.slice(0, 200);
  } catch {
    return raw.slice(0, 200);
  }
}
