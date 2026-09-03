import { ConfigService } from '@nestjs/config';
import { AiJobType, PrismaClient, ProcessingStatus } from '@prisma/client';
import { AIService, type AIRequest } from '../src/ai/ai.service';
import type { FetchLike } from '../src/ai/ai-provider';
import { Env } from '../src/config/env.schema';
import { PrismaService } from '../src/infra/prisma.service';

const prisma = new PrismaClient();

interface Reply {
  ok?: boolean;
  status?: number;
  body: string;
  headers?: Record<string, string>;
}

const answer = (text = 'Özet.', usage = { input_tokens: 1_000, output_tokens: 500 }): Reply => ({
  body: JSON.stringify({
    model: 'claude-sonnet-5-20260101',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage,
  }),
});

/** Replies in sequence, so a retry can be given a different answer. */
const transport = (replies: Reply[]): { fetchImpl: FetchLike; count: () => number } => {
  let calls = 0;

  const fetchImpl: FetchLike = () => {
    const reply = replies[Math.min(calls, replies.length - 1)]!;
    calls += 1;

    return Promise.resolve({
      ok: reply.ok ?? true,
      status: reply.status ?? 200,
      headers: { get: (name: string) => reply.headers?.[name] ?? null },
      text: () => Promise.resolve(reply.body),
    });
  };

  return { fetchImpl, count: () => calls };
};

/** Never answers; only the deadline ends it. */
const silentTransport: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });

const BASE = {
  AI_TIMEOUT_MS: 5_000,
  AI_MAX_OUTPUT_TOKENS: 512,
  AI_ZERO_RETENTION: true,
  AI_PROVIDER: 'anthropic',
  AI_API_KEY: 'sk-test',
  AI_MODEL: 'claude-sonnet-5',
  AI_PRICE_INPUT_PER_MTOK: 3,
  AI_PRICE_OUTPUT_PER_MTOK: 15,
  AI_MONTHLY_BUDGET_USD: undefined,
};

const serviceWith = (
  overrides: Record<string, unknown>,
  fetchImpl: FetchLike,
): AIService => {
  const values = { ...BASE, ...overrides };
  const config = {
    get: (key: string) => values[key as keyof typeof values],
  } as unknown as ConfigService<Env, true>;

  const service = new AIService(prisma as unknown as PrismaService, config, fetchImpl);
  service.onModuleInit();

  return service;
};

const clinical = (overrides: Partial<AIRequest> = {}): AIRequest => ({
  purpose: AiJobType.MESSAGE_SUMMARY,
  system: 'Sen bir klinik asistanısın. Tanı koymazsın.',
  messages: [{ role: 'user', content: '45 yaşında kadın, ameliyat sonrası 9. gün, yarada kızarıklık.' }],
  containsHealthData: true,
  ...overrides,
});

/**
 * The one door every AI call goes through (spec sections 3.4 and 14).
 *
 * Most of these tests are about calls that must *not* happen. The rules in
 * section 14 are conditions on every call, and a condition enforced at each
 * call site is one that a future call site will be written without.
 */
describe('the AI gate', () => {
  beforeEach(async () => {
    // This suite is the only writer of ai_jobs, and the budget arithmetic is
    // exact only if it starts from a known total.
    await prisma.aiJob.deleteMany({});
  });

  afterAll(async () => {
    await prisma.aiJob.deleteMany({});
    await prisma.$disconnect();
  });

  describe('before anything is sent', () => {
    it('refuses when no provider is configured, and writes no row for it', async () => {
      const service = serviceWith({ AI_API_KEY: undefined }, transport([answer()]).fetchImpl);

      const result = await service.complete(clinical());

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe('not-configured');
      // A standing condition, not an event: a row per call would fill the table
      // with the same line and bury the refusals that mean something.
      expect(await prisma.aiJob.count()).toBe(0);
    });

    /**
     * Section 14.5. Nothing in the code can verify the provider's terms, which
     * is exactly why the switch defaults to off and clinical prompts are
     * refused until an operator asserts it.
     */
    it('refuses a clinical prompt when zero-retention is not asserted', async () => {
      const { fetchImpl, count } = transport([answer()]);
      const service = serviceWith({ AI_ZERO_RETENTION: false }, fetchImpl);

      const result = await service.complete(clinical());

      expect(result.ok === false && result.reason).toBe('no-zero-retention');
      expect(count()).toBe(0);

      const job = await prisma.aiJob.findFirstOrThrow();
      expect(job.status).toBe(ProcessingStatus.FAILED);
      expect(job.error).toContain('no-zero-retention');
    });

    /** A prompt with no patient data in it is not health data, and may go. */
    it('still allows a non-clinical prompt without zero-retention', async () => {
      const { fetchImpl, count } = transport([answer()]);
      const service = serviceWith({ AI_ZERO_RETENTION: false }, fetchImpl);

      const result = await service.complete(
        clinical({ containsHealthData: false, messages: [{ role: 'user', content: 'Merhaba' }] }),
      );

      expect(result.ok).toBe(true);
      expect(count()).toBe(1);
    });

    /**
     * The backstop for a caller who declared the prompt clean and then
     * interpolated a name into it — which is what happens when the prompt is
     * built from the patient's own message.
     */
    it('refuses a prompt carrying a name, and never repeats the name', async () => {
      const { fetchImpl, count } = transport([answer()]);
      const service = serviceWith({}, fetchImpl);

      const result = await service.complete(
        clinical({
          messages: [{ role: 'user', content: 'Ayşe Yılmaz dün akşam ateşlendi.' }],
          identifiers: { names: ['Ayşe', 'Yılmaz'], mrn: 'MRN-90210' },
        }),
      );

      expect(result.ok === false && result.reason).toBe('identifier-in-prompt');
      expect(count()).toBe(0);

      const job = await prisma.aiJob.findFirstOrThrow();
      expect(job.error).toContain('name');
      expect(job.error).not.toContain('Ay');
    });

    it('lets a properly pseudonymised prompt through', async () => {
      const { fetchImpl, count } = transport([answer()]);
      const service = serviceWith({}, fetchImpl);

      const result = await service.complete(
        clinical({ identifiers: { names: ['Ayşe', 'Yılmaz'], mrn: 'MRN-90210' } }),
      );

      expect(result.ok).toBe(true);
      expect(count()).toBe(1);
    });
  });

  describe('accounting', () => {
    it('records tokens, cost and the model that actually answered', async () => {
      const service = serviceWith({}, transport([answer()]).fetchImpl);

      const result = await service.complete(clinical());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // 1000 in at $3/Mtok plus 500 out at $15/Mtok.
      expect(result.costUsd).toBeCloseTo(0.0105, 6);
      expect(result.model).toBe('claude-sonnet-5-20260101');

      const job = await prisma.aiJob.findUniqueOrThrow({ where: { id: result.jobId } });
      expect(job.status).toBe(ProcessingStatus.DONE);
      expect(job.tokensIn).toBe(1_000);
      expect(job.tokensOut).toBe(500);
      // The dated version, not the alias asked for (spec section 14.6).
      expect(job.model).toBe('claude-sonnet-5-20260101');
      expect(Number(job.costUsd)).toBeCloseTo(0.0105, 6);
    });

    it('refuses once the month is spent', async () => {
      const { fetchImpl, count } = transport([answer()]);
      const service = serviceWith({ AI_MONTHLY_BUDGET_USD: 0.01 }, fetchImpl);

      await service.complete(clinical());
      expect(count()).toBe(1);

      const second = await service.complete(clinical());

      expect(second.ok === false && second.reason).toBe('budget-exhausted');
      // Refused before a token was sent, not after.
      expect(count()).toBe(1);
    });

    it('reports the month for the doctor panel', async () => {
      const service = serviceWith({ AI_MONTHLY_BUDGET_USD: 1 }, transport([answer()]).fetchImpl);

      await service.complete(clinical());
      await service.complete(clinical({ containsHealthData: false }));

      const usage = await service.usage();

      expect(usage.enabled).toBe(true);
      expect(usage.calls).toBe(2);
      expect(usage.failed).toBe(0);
      expect(usage.tokensIn).toBe(2_000);
      expect(usage.spentUsd).toBeCloseTo(0.021, 6);
      expect(usage.budgetUsedFraction).toBeCloseTo(0.021, 4);
    });

    it('counts refusals as failures, so they are visible in the panel', async () => {
      const service = serviceWith({ AI_ZERO_RETENTION: false }, transport([answer()]).fetchImpl);

      await service.complete(clinical());

      expect((await service.usage()).failed).toBe(1);
    });

    /**
     * Cost accounting is mandatory, so an unpriced model is not one this system
     * will spend on — and the clinic keeps working while the reason sits in the
     * log rather than in next month's invoice.
     */
    it('stays switched off when the model has no configured price', async () => {
      const { fetchImpl, count } = transport([answer()]);
      const service = serviceWith({ AI_PRICE_INPUT_PER_MTOK: undefined }, fetchImpl);

      expect(service.enabled).toBe(false);

      const result = await service.complete(clinical());

      expect(result.ok === false && result.reason).toBe('not-configured');
      expect(count()).toBe(0);
    });
  });

  describe('when the provider misbehaves', () => {
    it('retries a provider that is briefly broken', async () => {
      const { fetchImpl, count } = transport([
        { ok: false, status: 503, body: JSON.stringify({ error: { message: 'overloaded' } }) },
        answer(),
      ]);
      const service = serviceWith({}, fetchImpl);

      const result = await service.complete(clinical());

      expect(result.ok).toBe(true);
      expect(count()).toBe(2);

      const job = await prisma.aiJob.findFirstOrThrow();
      expect(job.attempts).toBe(2);
    });

    /**
     * The failure this rule exists for: retrying a rejected key three times
     * turns an instant, obvious misconfiguration into something that looks like
     * a slow model.
     */
    it('does not retry a rejected key', async () => {
      const { fetchImpl, count } = transport([
        { ok: false, status: 401, body: JSON.stringify({ error: { message: 'invalid key' } }) },
      ]);
      const service = serviceWith({}, fetchImpl);

      const result = await service.complete(clinical());

      expect(result.ok === false && result.reason).toBe('provider-failed');
      expect(count()).toBe(1);
    });

    it('gives up after the attempt limit and records the failure', async () => {
      const { fetchImpl, count } = transport([
        { ok: false, status: 500, body: JSON.stringify({ error: { message: 'boom' } }) },
      ]);
      const service = serviceWith({}, fetchImpl);

      const result = await service.complete(clinical());

      expect(result.ok).toBe(false);
      expect(count()).toBe(3);

      const job = await prisma.aiJob.findFirstOrThrow();
      expect(job.status).toBe(ProcessingStatus.FAILED);
      expect(job.attempts).toBe(3);
    });

    /** An AI call with no deadline is a request handler that never returns. */
    it('stops waiting at the deadline', async () => {
      const service = serviceWith({ AI_TIMEOUT_MS: 60 }, silentTransport);

      const started = Date.now();
      const result = await service.complete(clinical());

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.message).toContain('60ms');
      // Three attempts of 60ms plus backoff, nowhere near the 5s default.
      expect(Date.now() - started).toBeLessThan(5_000);
    });

    /**
     * A fragment of a clinical summary is not a shorter summary — it is one
     * missing its end, which is usually where the caveats are.
     */
    it('marks an answer the model ran out of room for', async () => {
      const { fetchImpl } = transport([
        {
          body: JSON.stringify({
            model: 'claude-sonnet-5',
            content: [{ type: 'text', text: 'Hastanın durumu' }],
            stop_reason: 'max_tokens',
            usage: { input_tokens: 10, output_tokens: 512 },
          }),
        },
      ]);
      const service = serviceWith({}, fetchImpl);

      const result = await service.complete(clinical());

      expect(result.ok === true && result.truncated).toBe(true);
    });
  });
});
