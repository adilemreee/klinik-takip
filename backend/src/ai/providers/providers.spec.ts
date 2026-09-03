import { ProviderError, type FetchLike } from '../ai-provider';
import { AnthropicProvider } from './anthropic.provider';
import { OpenAIProvider } from './openai.provider';
import { UnconfiguredProvider } from './unconfigured.provider';

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

const transport = (
  reply: { ok?: boolean; status?: number; body: string; headers?: Record<string, string> },
): { fetchImpl: FetchLike; calls: Call[] } => {
  const calls: Call[] = [];

  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });

    return Promise.resolve({
      ok: reply.ok ?? true,
      status: reply.status ?? 200,
      headers: { get: (name: string) => reply.headers?.[name] ?? null },
      text: () => Promise.resolve(reply.body),
    });
  };

  return { fetchImpl, calls };
};

const anthropicBody = JSON.stringify({
  model: 'claude-sonnet-5-20260101',
  content: [{ type: 'text', text: 'Özet: ' }, { type: 'text', text: 'iyileşme normal.' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 120, output_tokens: 40 },
});

const openaiBody = JSON.stringify({
  model: 'gpt-5-2026-01-01',
  choices: [{ message: { content: 'Özet: iyileşme normal.' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 120, completion_tokens: 40 },
});

const request = {
  system: 'Sen bir klinik asistanısın.',
  messages: [{ role: 'user' as const, content: '45 yaşında kadın, 9. gün.' }],
  maxOutputTokens: 500,
};

/**
 * The seam that makes the provider swappable (spec section 3.4).
 *
 * These tests are about the shape of what goes out and what comes back —
 * including that the key goes in a header and nowhere else, which is the sort
 * of thing that is obvious until somebody adds a debug log.
 */
describe('the Anthropic provider', () => {
  it('sends the system prompt as a field and the key as a header', async () => {
    const { fetchImpl, calls } = transport({ body: anthropicBody });

    await new AnthropicProvider('claude-sonnet-5', 'sk-test-key', fetchImpl).complete(
      request,
      new AbortController().signal,
    );

    const call = calls[0]!;
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.headers['x-api-key']).toBe('sk-test-key');
    expect(call.headers['anthropic-version']).toBe('2023-06-01');
    expect(call.body.system).toBe(request.system);
    expect(call.body.max_tokens).toBe(500);
  });

  it('never puts the key in the body', async () => {
    const { fetchImpl, calls } = transport({ body: anthropicBody });

    await new AnthropicProvider('claude-sonnet-5', 'sk-test-key', fetchImpl).complete(
      request,
      new AbortController().signal,
    );

    expect(JSON.stringify(calls[0]!.body)).not.toContain('sk-test-key');
  });

  it('joins the text blocks and reports the model that actually answered', async () => {
    const { fetchImpl } = transport({ body: anthropicBody });

    const response = await new AnthropicProvider('claude-sonnet-5', 'k', fetchImpl).complete(
      request,
      new AbortController().signal,
    );

    expect(response.text).toBe('Özet: iyileşme normal.');
    // The dated version, not the alias we asked for — that is what section 14.6
    // wants on the record.
    expect(response.model).toBe('claude-sonnet-5-20260101');
    expect(response.usage).toEqual({ inputTokens: 120, outputTokens: 40 });
    expect(response.stopReason).toBe('end_turn');
  });

  it('turns a refusal into an error carrying the status and the wait', async () => {
    const { fetchImpl } = transport({
      ok: false,
      status: 429,
      headers: { 'retry-after': '7' },
      body: JSON.stringify({ error: { message: 'rate limited' } }),
    });

    const failure = await new AnthropicProvider('m', 'k', fetchImpl)
      .complete(request, new AbortController().signal)
      .catch((error: unknown) => error as ProviderError);

    expect(failure).toBeInstanceOf(ProviderError);
    expect((failure as ProviderError).status).toBe(429);
    expect((failure as ProviderError).retryAfterSeconds).toBe(7);
  });

  /** No status is what marks a transport failure retryable. */
  it('reports an unreachable provider with no status', async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error('ECONNREFUSED'));

    const failure = await new AnthropicProvider('m', 'k', fetchImpl)
      .complete(request, new AbortController().signal)
      .catch((error: unknown) => error as ProviderError);

    expect((failure as ProviderError).status).toBeNull();
  });

  /**
   * An error body can quote the request back, and this system's requests are
   * clinical prompts. The message is truncated so a log line cannot become the
   * copy of a prompt.
   */
  it('keeps a provider error message short', async () => {
    const { fetchImpl } = transport({
      ok: false,
      status: 400,
      body: JSON.stringify({ error: { message: 'x'.repeat(5_000) } }),
    });

    const failure = await new AnthropicProvider('m', 'k', fetchImpl)
      .complete(request, new AbortController().signal)
      .catch((error: unknown) => error as ProviderError);

    expect((failure as ProviderError).message.length).toBeLessThanOrEqual(300);
  });
});

describe('the OpenAI provider', () => {
  /** The whole list of differences from Anthropic, and it is short. */
  it('sends the system prompt as the first message and the key as a bearer token', async () => {
    const { fetchImpl, calls } = transport({ body: openaiBody });

    await new OpenAIProvider('gpt-5', 'sk-openai', fetchImpl).complete(
      request,
      new AbortController().signal,
    );

    const call = calls[0]!;
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(call.headers.authorization).toBe('Bearer sk-openai');
    expect(call.body.messages).toEqual([
      { role: 'system', content: request.system },
      { role: 'user', content: request.messages[0]!.content },
    ]);
    expect(call.body.max_completion_tokens).toBe(500);
  });

  it('returns the same shape as the other provider', async () => {
    const { fetchImpl } = transport({ body: openaiBody });

    const response = await new OpenAIProvider('gpt-5', 'k', fetchImpl).complete(
      request,
      new AbortController().signal,
    );

    expect(response).toEqual({
      text: 'Özet: iyileşme normal.',
      model: 'gpt-5-2026-01-01',
      usage: { inputTokens: 120, outputTokens: 40 },
      stopReason: 'stop',
    });
  });

  it('reports a truncated answer through its stop reason', async () => {
    const { fetchImpl } = transport({
      body: JSON.stringify({
        model: 'gpt-5',
        choices: [{ message: { content: 'yarım' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 10, completion_tokens: 500 },
      }),
    });

    const response = await new OpenAIProvider('gpt-5', 'k', fetchImpl).complete(
      request,
      new AbortController().signal,
    );

    expect(response.stopReason).toBe('length');
  });
});

/**
 * A stub that returned plausible text would put invented clinical content in
 * front of a doctor with a model name and a timestamp on it.
 */
describe('the unconfigured provider', () => {
  it('refuses fatally rather than inventing an answer', async () => {
    const failure = await new UnconfiguredProvider()
      .complete()
      .catch((error: unknown) => error as ProviderError);

    expect(failure).toBeInstanceOf(ProviderError);
    expect((failure as ProviderError).status).toBe(501);
  });
});
