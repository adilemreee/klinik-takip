import { ProviderError, type FetchLike } from '../ai-provider';
import { PROVIDERS } from '../model-catalogue';
import { DeepSeekProvider } from './deepseek.provider';
import { GeminiProvider } from './gemini.provider';
import { OpenAIProvider } from './openai.provider';

/**
 * Gemini and DeepSeek (spec 3.4).
 *
 * The seam's claim is that a new provider is a translation and nothing else.
 * These tests check the translation both ways — what goes out in the provider's
 * own shape, and what comes back — because a wrong field name here surfaces as
 * a clinical summary that is silently empty.
 */
describe('the other two providers', () => {
  const capture = (
    body: string,
    status = 200,
    headers: Record<string, string> = {},
  ): { fetchImpl: FetchLike; sent: { url: string; headers: Record<string, string>; body: unknown }[] } => {
    const sent: { url: string; headers: Record<string, string>; body: unknown }[] = [];

    const fetchImpl: FetchLike = (url, init) => {
      sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });

      // The shape FetchLike already describes; no cast needed.
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(body),
        headers: { get: (name: string) => headers[name] ?? null },
      });
    };

    return { fetchImpl, sent };
  };

  const signal = new AbortController().signal;

  describe('Gemini', () => {
    const ok = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'merhaba' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4 },
      modelVersion: 'gemini-2.5-pro-002',
    });

    it('sends the system prompt where Gemini expects it', async () => {
      const { fetchImpl, sent } = capture(ok);

      await new GeminiProvider('gemini-2.5-pro', 'key', fetchImpl).complete(
        { system: 'kurallar', messages: [{ role: 'user', content: 'soru' }], maxOutputTokens: 100 },
        signal,
      );

      const body = sent[0]!.body as Record<string, never>;
      // Its own field, not a message with a special role.
      expect(body.systemInstruction).toEqual({ parts: [{ text: 'kurallar' }] });
      expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'soru' }] }]);
    });

    it('calls the assistant "model", which is its word for it', async () => {
      const { fetchImpl, sent } = capture(ok);

      await new GeminiProvider('gemini-2.5-pro', 'key', fetchImpl).complete(
        {
          system: 's',
          messages: [
            { role: 'user', content: 'a' },
            { role: 'assistant', content: 'b' },
          ],
          maxOutputTokens: 100,
        },
        signal,
      );

      const body = sent[0]!.body as { contents: { role: string }[] };
      expect(body.contents.map((c) => c.role)).toEqual(['user', 'model']);
    });

    it('puts the key in a header rather than the URL', async () => {
      // A URL travels into proxy logs and error reports; a key in one of those
      // is a key that has to be rotated.
      const { fetchImpl, sent } = capture(ok);

      await new GeminiProvider('gemini-2.5-pro', 'secret-key', fetchImpl).complete(
        { system: 's', messages: [], maxOutputTokens: 10 },
        signal,
      );

      expect(sent[0]!.url).not.toContain('secret-key');
      expect(sent[0]!.headers['x-goog-api-key']).toBe('secret-key');
    });

    it('reads the answer and the token counts out of its own field names', async () => {
      const { fetchImpl } = capture(ok);

      const response = await new GeminiProvider('gemini-2.5-pro', 'key', fetchImpl).complete(
        { system: 's', messages: [], maxOutputTokens: 10 },
        signal,
      );

      expect(response.text).toBe('merhaba');
      expect(response.usage).toEqual({ inputTokens: 11, outputTokens: 4 });
      // The version that actually answered, not the one that was asked for.
      expect(response.model).toBe('gemini-2.5-pro-002');
      expect(response.stopReason).toBe('STOP');
    });

    it('treats a blocked request as a failure, not as an empty answer', async () => {
      // Gemini answers 200 with no candidate when a safety filter fires. An
      // empty clinical summary that looks successful is worse than an error.
      const { fetchImpl } = capture(JSON.stringify({ candidates: [] }));

      await expect(
        new GeminiProvider('gemini-2.5-pro', 'key', fetchImpl).complete(
          { system: 's', messages: [], maxOutputTokens: 10 },
          signal,
        ),
      ).rejects.toThrow(ProviderError);
    });

    it('sends an image the way Gemini takes one', async () => {
      const { fetchImpl, sent } = capture(ok);

      await new GeminiProvider('gemini-2.5-pro', 'key', fetchImpl).complete(
        {
          system: 's',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'bak' },
                { type: 'image', mediaType: 'image/jpeg', base64: 'AAAA' },
              ],
            },
          ],
          maxOutputTokens: 10,
        },
        signal,
      );

      const body = sent[0]!.body as { contents: { parts: Record<string, never>[] }[] };
      expect(body.contents[0]!.parts[1]!.inlineData).toEqual({
        mimeType: 'image/jpeg',
        data: 'AAAA',
      });
    });

    it('reports a refusal in the provider’s own words', async () => {
      const { fetchImpl } = capture(
        JSON.stringify({ error: { message: 'API key not valid' } }),
        400,
      );

      await expect(
        new GeminiProvider('gemini-2.5-pro', 'bad', fetchImpl).complete(
          { system: 's', messages: [], maxOutputTokens: 10 },
          signal,
        ),
      ).rejects.toThrow(/API key not valid/);
    });
  });

  describe('DeepSeek', () => {
    const ok = JSON.stringify({
      model: 'deepseek-chat',
      choices: [{ message: { content: 'tamam' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 7, completion_tokens: 2 },
    });

    it('goes to DeepSeek rather than to OpenAI', async () => {
      // The entire difference between the two, and the reason it is a base URL
      // instead of a second copy of the request body.
      const { fetchImpl, sent } = capture(ok);

      await new DeepSeekProvider('deepseek-chat', 'key', fetchImpl).complete(
        { system: 's', messages: [{ role: 'user', content: 'a' }], maxOutputTokens: 10 },
        signal,
      );

      expect(sent[0]!.url).toBe('https://api.deepseek.com/chat/completions');
      expect(sent[0]!.headers.authorization).toBe('Bearer key');
    });

    it('speaks the same protocol, so the body is identical to OpenAI’s', async () => {
      const deepseek = capture(ok);
      const openai = capture(ok);
      const request = {
        system: 'kurallar',
        messages: [{ role: 'user' as const, content: 'soru' }],
        maxOutputTokens: 64,
      };

      await new DeepSeekProvider('m', 'key', deepseek.fetchImpl).complete(request, signal);
      await new OpenAIProvider('m', 'key', openai.fetchImpl).complete(request, signal);

      expect(deepseek.sent[0]!.body).toEqual(openai.sent[0]!.body);
    });

    it('reports itself as deepseek, so the usage log says which one answered', async () => {
      const { fetchImpl } = capture(ok);
      const provider = new DeepSeekProvider('deepseek-chat', 'key', fetchImpl);

      expect(provider.name).toBe('deepseek');
      await expect(
        provider.complete({ system: 's', messages: [], maxOutputTokens: 10 }, signal),
      ).resolves.toMatchObject({ text: 'tamam' });
    });

    it('names DeepSeek, not OpenAI, when it cannot be reached', async () => {
      const failing: FetchLike = () => Promise.reject(new Error('ENOTFOUND'));

      await expect(
        new DeepSeekProvider('m', 'key', failing).complete(
          { system: 's', messages: [], maxOutputTokens: 10 },
          signal,
        ),
      ).rejects.toThrow(/Could not reach DeepSeek/);
    });
  });

  describe('the catalogue', () => {
    it('has an entry for every selectable provider', () => {
      expect(Object.keys(PROVIDERS).sort()).toEqual([
        'anthropic',
        'deepseek',
        'gemini',
        'openai',
      ]);
    });

    it('carries no prices, because a stale price is believed', () => {
      // The budget guard spends real money against whatever number it is given.
      const text = JSON.stringify(PROVIDERS);

      expect(text).not.toMatch(/price.*\d/i);
      for (const provider of Object.values(PROVIDERS)) {
        expect(provider.pricingUrl).toMatch(/^https:\/\//);
        expect(provider.consoleUrl).toMatch(/^https:\/\//);
      }
    });

    it('says what has to be checked about each one’s data handling', () => {
      for (const provider of Object.values(PROVIDERS)) {
        expect(provider.retentionNote.length).toBeGreaterThan(40);
      }
    });

    it('warns specifically about the two with the weakest defaults', () => {
      // Google's free tier trains on what it is sent; DeepSeek's standard terms
      // allow retention on servers in another jurisdiction. Neither is refused
      // here — both are stated.
      expect(PROVIDERS.gemini.retentionNote).toMatch(/ÜCRETSİZ|ücretsiz/);
      expect(PROVIDERS.deepseek.retentionNote).toMatch(/Çin/);
    });
  });
});
