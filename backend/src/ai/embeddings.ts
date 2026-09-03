import { ProviderError, type FetchLike } from './ai-provider';
import { parseRetryAfter } from './retry';

/**
 * Turning text into a vector, behind its own seam.
 *
 * Separate from `AIProvider` rather than a method on it, because the two are
 * not the same market: Anthropic has no embeddings API at all, so a clinic can
 * reasonably answer with one provider and embed with another — or answer with
 * one and not embed at all, which is the state this ships in.
 *
 * When no embedding provider is configured, retrieval falls back to the lexical
 * search, the assistant is stricter about what counts as evidence, and nothing
 * silently degrades into answering from the model's own memory.
 */

const ENDPOINT = 'https://api.openai.com/v1/embeddings';

/** The column is `vector(1536)`; a provider returning anything else is refused. */
export const EMBEDDING_DIMENSIONS = 1_536;

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  tokens: number;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  embed(inputs: string[], signal: AbortSignal): Promise<EmbeddingResult>;
}

interface OpenAIEmbeddingResponse {
  model?: string;
  data?: { embedding?: number[]; index?: number }[];
  usage?: { prompt_tokens?: number };
  error?: { message?: string };
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai' as const;

  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike,
  ) {}

  async embed(inputs: string[], signal: AbortSignal): Promise<EmbeddingResult> {
    const response = await this.fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: inputs }),
      signal,
    }).catch((error: unknown) => {
      throw new ProviderError(`Could not reach the embedding provider: ${String(error)}`, null);
    });

    const raw = await response.text();

    if (!response.ok) {
      throw new ProviderError(
        `The embedding provider refused the request: ${messageFrom(raw)}`,
        response.status,
        parseRetryAfter(response.headers.get('retry-after')),
      );
    }

    let body: OpenAIEmbeddingResponse;

    try {
      body = JSON.parse(raw) as OpenAIEmbeddingResponse;
    } catch {
      throw new ProviderError('The embedding provider returned a body that is not JSON', null);
    }

    // Ordered by the provider's own index rather than by array position: a
    // response reordered in transit would attach every chunk's vector to the
    // wrong chunk, and nothing downstream could tell.
    const ordered = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vectors = ordered.map((item) => item.embedding ?? []);

    if (vectors.length !== inputs.length) {
      throw new ProviderError(
        `Asked for ${inputs.length} embeddings and got ${vectors.length}`,
        null,
      );
    }

    for (const vector of vectors) {
      if (vector.length !== EMBEDDING_DIMENSIONS) {
        // A model with different dimensions cannot be stored in this column,
        // and storing a truncated one would poison every later search.
        throw new ProviderError(
          `Expected ${EMBEDDING_DIMENSIONS}-dimensional embeddings, got ${vector.length}`,
          400,
        );
      }
    }

    return {
      vectors,
      model: body.model ?? this.model,
      tokens: body.usage?.prompt_tokens ?? 0,
    };
  }
}

function messageFrom(raw: string): string {
  try {
    return (JSON.parse(raw) as OpenAIEmbeddingResponse).error?.message ?? 'no message';
  } catch {
    return 'no message';
  }
}

/** Cosine similarity, for ranking a query against stored vectors in memory. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index]! * b[index]!;
    normA += a[index]! * a[index]!;
    normB += b[index]! * b[index]!;
  }

  if (normA === 0 || normB === 0) return 0;

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
