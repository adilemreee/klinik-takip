import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiJobType, Prisma, ProcessingStatus } from '@prisma/client';
import { instantAt, localDate } from '../common/local-calendar';
import { Env } from '../config/env.schema';
import { PrismaService } from '../infra/prisma.service';
import {
  ProviderError,
  textOf,
  type AIMessage,
  type AIProvider,
  type FetchLike,
} from './ai-provider';
import { budgetUsedFraction, costUsd, withinBudget, type Pricing, type TokenUsage } from './cost';
import { OpenAIEmbeddingProvider, type EmbeddingProvider } from './embeddings';
import { findLeaks, type Identifiers, type Leak } from './pseudonymise';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAIProvider } from './providers/openai.provider';
import { UnconfiguredProvider } from './providers/unconfigured.provider';
import { backoffMs, shouldRetry, MAX_ATTEMPTS } from './retry';

/**
 * The clinic's month, for the budget window. The same default as the
 * notification preferences and the follow-up calendar use.
 */
const CLINIC_TIMEZONE = 'Europe/Istanbul';

/**
 * The HTTP call the providers make, behind a token.
 *
 * A token rather than a defaulted constructor parameter: a plain function type
 * is not something Nest can resolve, and a default value does not stop it
 * trying. Behind a token, the module supplies the real `fetch` and a test
 * supplies one that never touches a network.
 */
export const AI_FETCH = Symbol('AI_FETCH');

export type AIRefusalReason =
  | 'not-configured'
  | 'no-zero-retention'
  | 'identifier-in-prompt'
  | 'budget-exhausted'
  | 'provider-failed';

export interface AIRequest {
  purpose: AiJobType;
  system: string;
  messages: AIMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  /**
   * Whether anything in this prompt came from a patient record.
   *
   * Declared by the caller rather than guessed, and it gates the zero-retention
   * check. Callers are expected to be honest about it; `identifiers` is the
   * backstop that catches them when they are not.
   */
  containsHealthData: boolean;
  /** Identifiers that must not appear in the prompt. Checked, not trusted. */
  identifiers?: Identifiers;
  /** Recorded on the job row for traceability. Never sent to the provider. */
  patientId?: string;
}

export interface AISuccess {
  ok: true;
  jobId: string;
  text: string;
  /** As the provider reported it (spec section 14.6). */
  model: string;
  usage: TokenUsage;
  costUsd: number | null;
  /**
   * The model ran out of room. The text is a fragment, and a fragment of a
   * clinical summary is not a shorter summary — it is a summary missing its
   * end, which is usually where the caveats are.
   */
  truncated: boolean;
}

export interface AIRefusal {
  ok: false;
  jobId: string | null;
  reason: AIRefusalReason;
  message: string;
}

export type AIResult = AISuccess | AIRefusal;

export interface UsageReport {
  enabled: boolean;
  provider: string;
  model: string;
  monthStart: Date;
  spentUsd: number;
  budgetUsd: number | null;
  budgetUsedFraction: number | null;
  calls: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Everything above the provider seam (spec sections 3.4 and 14).
 *
 * The point of putting all of it here rather than in each caller is that the
 * rules in section 14 are not advisory. Pseudonymisation, the zero-retention
 * gate, the budget and the audit trail are conditions on *every* call, and a
 * condition enforced at each call site is a condition that one call site will
 * eventually be written without.
 *
 * So there is one door, it returns a result a caller cannot mistake for an
 * answer, and it refuses by default.
 */
@Injectable()
export class AIService implements OnModuleInit {
  private readonly logger = new Logger(AIService.name);

  private provider: AIProvider = new UnconfiguredProvider();
  private embeddings: EmbeddingProvider | null = null;
  private embeddingPricing: Pricing | null = null;
  private pricing: Pricing | null = null;
  private budgetUsd: number | null = null;
  private zeroRetention = false;
  private timeoutMs = 60_000;
  private defaultMaxOutputTokens = 1_024;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    /** Injected so the providers can be exercised without a network. */
    @Inject(AI_FETCH) private readonly fetchImpl: FetchLike,
  ) {}

  onModuleInit(): void {
    this.timeoutMs = this.config.get('AI_TIMEOUT_MS', { infer: true });
    this.defaultMaxOutputTokens = this.config.get('AI_MAX_OUTPUT_TOKENS', { infer: true });
    this.zeroRetention = this.config.get('AI_ZERO_RETENTION', { infer: true });
    this.budgetUsd = this.config.get('AI_MONTHLY_BUDGET_USD', { infer: true }) ?? null;

    const name = this.config.get('AI_PROVIDER', { infer: true });
    const apiKey = this.config.get('AI_API_KEY', { infer: true });
    const model = this.config.get('AI_MODEL', { infer: true });
    const inputPrice = this.config.get('AI_PRICE_INPUT_PER_MTOK', { infer: true });
    const outputPrice = this.config.get('AI_PRICE_OUTPUT_PER_MTOK', { infer: true });

    if (!name || !apiKey || !model) {
      this.logger.log('No AI provider configured; the AI layer will refuse every call');
      return;
    }

    // Cost accounting is mandatory, so an unpriced model is not a model this
    // system will spend on. Refusing to enable is louder than recording nulls
    // and quieter than refusing to boot — the clinic keeps working, and the
    // reason is in the log rather than in an invoice next month.
    if (inputPrice === undefined || outputPrice === undefined) {
      this.logger.error(
        `AI provider ${name} is configured but AI_PRICE_INPUT_PER_MTOK / AI_PRICE_OUTPUT_PER_MTOK are not. ` +
          'Cost accounting is mandatory, so the AI layer stays off.',
      );
      return;
    }

    this.pricing = { inputPerMillionUsd: inputPrice, outputPerMillionUsd: outputPrice };
    this.provider =
      name === 'anthropic'
        ? new AnthropicProvider(model, apiKey, this.fetchImpl)
        : new OpenAIProvider(model, apiKey, this.fetchImpl);

    this.logger.log(
      `AI layer enabled: ${name} ${model}` +
        (this.zeroRetention ? '' : ' — WITHOUT zero-retention, so clinical prompts will be refused'),
    );

    this.configureEmbeddings();
  }

  /**
   * Configured on its own, and allowed to be absent.
   *
   * Without it the protocol assistant keeps working from the lexical search
   * alone; what must not happen is retrieval quietly returning nothing and the
   * assistant answering anyway, and that is prevented above this layer.
   */
  private configureEmbeddings(): void {
    const provider = this.config.get('AI_EMBEDDING_PROVIDER', { infer: true });
    const apiKey = this.config.get('AI_EMBEDDING_API_KEY', { infer: true });
    const model = this.config.get('AI_EMBEDDING_MODEL', { infer: true });
    const price = this.config.get('AI_EMBEDDING_PRICE_PER_MTOK', { infer: true });

    if (!provider || !apiKey || !model) {
      this.logger.log('No embedding provider configured; retrieval will be lexical only');
      return;
    }

    if (price === undefined) {
      this.logger.error(
        'An embedding provider is configured but AI_EMBEDDING_PRICE_PER_MTOK is not. ' +
          'Cost accounting is mandatory, so embeddings stay off.',
      );
      return;
    }

    // Output tokens do not exist for an embedding call; the same shape is
    // reused so one costing function covers both.
    this.embeddingPricing = { inputPerMillionUsd: price, outputPerMillionUsd: 0 };
    this.embeddings = new OpenAIEmbeddingProvider(model, apiKey, this.fetchImpl);

    this.logger.log(`Embeddings enabled: ${provider} ${model}`);
  }

  get enabled(): boolean {
    return this.provider.name !== 'unconfigured';
  }

  get embeddingsEnabled(): boolean {
    return this.embeddings !== null;
  }

  /**
   * The one door.
   *
   * Every gate runs before a single token is sent, and each refusal that got
   * as far as having a reason is written to `ai_jobs` — a budget that stopped a
   * triage run, or a prompt that carried a name, are both things somebody has
   * to be able to find afterwards. The exception is "not configured", which is
   * a standing condition rather than an event: recording it per call would fill
   * the table with the same row and bury the refusals that mean something.
   */
  async complete(request: AIRequest): Promise<AIResult> {
    if (!this.enabled) {
      return { ok: false, jobId: null, reason: 'not-configured', message: 'No AI provider is configured' };
    }

    if (request.containsHealthData && !this.zeroRetention) {
      return this.refuse(
        request,
        'no-zero-retention',
        'The provider account is not marked zero-retention, so clinical prompts are not sent',
      );
    }

    const leaks = findLeaks(this.render(request), request.identifiers);

    if (leaks.length > 0) {
      return this.refuse(
        request,
        'identifier-in-prompt',
        // Kinds, never values: this message is logged, and naming the
        // identifier would be the leak it just prevented.
        `The prompt carries identifying data (${leaks.map((leak: Leak) => leak.kind).join(', ')})`,
      );
    }

    const spentUsd = await this.spentThisMonth();

    if (!withinBudget({ spentUsd, budgetUsd: this.budgetUsd })) {
      return this.refuse(
        request,
        'budget-exhausted',
        `This month's AI budget of $${this.budgetUsd?.toFixed(2)} is spent`,
      );
    }

    return this.callProvider(request);
  }

  /**
   * Embeddings, through the same door as everything else.
   *
   * A vector is not less of a disclosure than a completion: the text still
   * leaves the building. So the zero-retention gate, the leak check, the budget
   * and the `ai_jobs` row all apply, and the only thing that differs is what
   * comes back.
   */
  async embed(input: {
    texts: string[];
    containsHealthData: boolean;
    identifiers?: Identifiers;
    patientId?: string;
  }): Promise<{ ok: true; vectors: number[][]; model: string } | AIRefusal> {
    const provider = this.embeddings;

    if (!provider) {
      return {
        ok: false,
        jobId: null,
        reason: 'not-configured',
        message: 'No embedding provider is configured',
      };
    }

    const request: AIRequest = {
      purpose: AiJobType.EMBEDDING,
      system: '',
      messages: input.texts.map((text) => ({ role: 'user' as const, content: text })),
      containsHealthData: input.containsHealthData,
      identifiers: input.identifiers,
      patientId: input.patientId,
    };

    if (input.containsHealthData && !this.zeroRetention) {
      return this.refuse(
        request,
        'no-zero-retention',
        'The provider account is not marked zero-retention, so clinical text is not embedded',
      );
    }

    const leaks = findLeaks(input.texts.join('\n'), input.identifiers);

    if (leaks.length > 0) {
      return this.refuse(
        request,
        'identifier-in-prompt',
        `The text carries identifying data (${leaks.map((leak: Leak) => leak.kind).join(', ')})`,
      );
    }

    const spentUsd = await this.spentThisMonth();

    if (!withinBudget({ spentUsd, budgetUsd: this.budgetUsd })) {
      return this.refuse(
        request,
        'budget-exhausted',
        `This month's AI budget of $${this.budgetUsd?.toFixed(2)} is spent`,
      );
    }

    const job = await this.prisma.aiJob.create({
      data: {
        type: AiJobType.EMBEDDING,
        status: ProcessingStatus.PROCESSING,
        inputRef: input.patientId ?? null,
        model: provider.model,
        startedAt: new Date(),
      },
    });

    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const result = await provider.embed(input.texts, controller.signal);
      const cost = this.embeddingPricing
        ? costUsd({ inputTokens: result.tokens, outputTokens: 0 }, this.embeddingPricing)
        : null;

      await this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: ProcessingStatus.DONE,
          model: result.model,
          tokensIn: result.tokens,
          tokensOut: 0,
          costUsd: cost === null ? null : new Prisma.Decimal(cost),
          attempts: 1,
          finishedAt: new Date(),
        },
      });

      return { ok: true, vectors: result.vectors, model: result.model };
    } catch (error: unknown) {
      const failure = this.asProviderError(error, controller.signal.aborted);

      await this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: ProcessingStatus.FAILED,
          error: failure.message.slice(0, 500),
          attempts: 1,
          finishedAt: new Date(),
        },
      });

      this.logger.error(`Embedding failed: ${failure.message}`);

      return { ok: false, jobId: job.id, reason: 'provider-failed', message: failure.message };
    } finally {
      clearTimeout(deadline);
    }
  }

  /** For the doctor's panel: what the month has cost so far (spec section 3.4). */
  async usage(now = new Date()): Promise<UsageReport> {
    const monthStart = this.monthStart(now);

    const totals = await this.prisma.aiJob.aggregate({
      where: { createdAt: { gte: monthStart } },
      _sum: { costUsd: true, tokensIn: true, tokensOut: true },
      _count: true,
    });

    const failed = await this.prisma.aiJob.count({
      where: { createdAt: { gte: monthStart }, status: ProcessingStatus.FAILED },
    });

    const spentUsd = Number(totals._sum.costUsd ?? 0);

    return {
      enabled: this.enabled,
      provider: this.provider.name,
      model: this.provider.model,
      monthStart,
      spentUsd,
      budgetUsd: this.budgetUsd,
      budgetUsedFraction: budgetUsedFraction({ spentUsd, budgetUsd: this.budgetUsd }),
      calls: totals._count,
      failed,
      tokensIn: totals._sum.tokensIn ?? 0,
      tokensOut: totals._sum.tokensOut ?? 0,
    };
  }

  private async callProvider(request: AIRequest): Promise<AIResult> {
    const job = await this.prisma.aiJob.create({
      data: {
        type: request.purpose,
        status: ProcessingStatus.PROCESSING,
        inputRef: request.patientId ?? null,
        model: this.provider.model,
        startedAt: new Date(),
      },
    });

    let lastError: ProviderError | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.provider.complete(
          {
            system: request.system,
            messages: request.messages,
            maxOutputTokens: request.maxOutputTokens ?? this.defaultMaxOutputTokens,
            temperature: request.temperature,
          },
          controller.signal,
        );

        const cost = this.pricing ? costUsd(response.usage, this.pricing) : null;

        await this.prisma.aiJob.update({
          where: { id: job.id },
          data: {
            status: ProcessingStatus.DONE,
            // The model the provider says answered, not the one we asked for:
            // they differ when an alias resolves to a dated version, and the
            // dated one is what section 14.6 wants on the record.
            model: response.model,
            tokensIn: response.usage.inputTokens,
            tokensOut: response.usage.outputTokens,
            costUsd: cost === null ? null : new Prisma.Decimal(cost),
            attempts: attempt,
            finishedAt: new Date(),
          },
        });

        return {
          ok: true,
          jobId: job.id,
          text: response.text,
          model: response.model,
          usage: response.usage,
          costUsd: cost,
          truncated: response.stopReason === 'max_tokens' || response.stopReason === 'length',
        };
      } catch (error: unknown) {
        lastError = this.asProviderError(error, controller.signal.aborted);

        if (!shouldRetry(lastError, attempt)) break;

        await this.wait(backoffMs(attempt, lastError));
      } finally {
        clearTimeout(deadline);
      }
    }

    const message = lastError?.message ?? 'The provider failed';

    await this.prisma.aiJob.update({
      where: { id: job.id },
      data: {
        status: ProcessingStatus.FAILED,
        error: message.slice(0, 500),
        attempts: MAX_ATTEMPTS,
        finishedAt: new Date(),
      },
    });

    this.logger.error(`AI call for ${request.purpose} failed: ${message}`);

    return { ok: false, jobId: job.id, reason: 'provider-failed', message };
  }

  /**
   * The deadline is checked before the error's own wording.
   *
   * An aborted fetch surfaces inside the provider as a transport failure, so
   * the error reaching here says the provider could not be reached — which
   * sends whoever is debugging it to look at DNS and firewalls when what
   * actually happened is that we stopped waiting. A timeout has no status,
   * which the retry policy reads as transient: correct, because the deadline
   * passing says nothing about whether the provider would have answered.
   */
  private asProviderError(error: unknown, aborted: boolean): ProviderError {
    if (aborted) {
      return new ProviderError(`The provider did not answer within ${this.timeoutMs}ms`, null);
    }

    if (error instanceof ProviderError) return error;

    return new ProviderError(String(error), null);
  }

  /** Recorded, so a refusal is something a person can find later. */
  private async refuse(
    request: AIRequest,
    reason: AIRefusalReason,
    message: string,
  ): Promise<AIRefusal> {
    const job = await this.prisma.aiJob.create({
      data: {
        type: request.purpose,
        status: ProcessingStatus.FAILED,
        inputRef: request.patientId ?? null,
        model: this.provider.model,
        error: `${reason}: ${message}`.slice(0, 500),
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });

    this.logger.warn(`AI call for ${request.purpose} refused — ${reason}`);

    return { ok: false, jobId: job.id, reason, message };
  }

  /**
   * Everything that will be sent, as one string, for the leak check.
   *
   * Images are not in it, and cannot be: a face or a tattoo in a wound photo is
   * an identifier no text scan will ever find. That limit is real and it is
   * written down in the photo assessment's own documentation rather than
   * hidden behind a check that looks like it covers everything.
   */
  private render(request: AIRequest): string {
    return [request.system, ...request.messages.map((message) => textOf(message.content))].join(
      '\n',
    );
  }

  private async spentThisMonth(now = new Date()): Promise<number> {
    const totals = await this.prisma.aiJob.aggregate({
      where: { createdAt: { gte: this.monthStart(now) } },
      _sum: { costUsd: true },
    });

    return Number(totals._sum.costUsd ?? 0);
  }

  /**
   * Midnight on the first, in the clinic's timezone.
   *
   * Not `new Date(year, month, 1)` in the server's zone: a budget that resets
   * at 03:00 on the first would let the last three hours of a month's spending
   * land in the new one, which is the kind of error nobody finds until the
   * month a limit actually bites.
   */
  private monthStart(now: Date): Date {
    const today = localDate(now, CLINIC_TIMEZONE);

    return instantAt({ ...today, day: 1 }, 0, CLINIC_TIMEZONE);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      // Unref'd: a backoff in flight must not be the reason a process refuses
      // to shut down.
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    });
  }
}
