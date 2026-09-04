import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiProviderName, AuditAction, type AiSetting } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { EncryptionService } from '../crypto/encryption.service';
import { PrismaService } from '../infra/prisma.service';
import type { SelectableProvider } from './ai-provider';
import { PROVIDERS, isKnownModel } from './model-catalogue';

/**
 * Which model service the clinic uses, and the key for it (spec 3.4, 14.5).
 *
 * Kept in the database because the doctor chooses this, and choosing it should
 * not need a deploy. Three rules hold it together.
 *
 * **The key goes in and does not come out.** It is encrypted at rest and no
 * endpoint returns it. A settings screen sees the last four characters, which
 * is the only question a screen genuinely has about a key: *which* one is it.
 *
 * **The zero-retention declaration belongs to a provider, not to the system.**
 * Anthropic, OpenAI, Google and DeepSeek do not offer the same terms — Google's
 * free tier trains on what you send it, and DeepSeek's standard terms allow
 * retention on servers in another jurisdiction. A declaration made about one of
 * them says nothing about the next, so changing the provider clears it and the
 * clinic has to say it again about the new one.
 *
 * **An unpriced model is not enabled.** Cost accounting is mandatory (spec
 * 14.6), and the budget guard spends real money against whatever number it is
 * given, so a blank price switches the AI layer off rather than defaulting to
 * zero.
 */

export interface AiSettingsView {
  provider: SelectableProvider | null;
  model: string | null;
  /** Never the key itself. */
  apiKeyLast4: string | null;
  hasApiKey: boolean;
  inputPricePerMTok: string | null;
  outputPricePerMTok: string | null;
  zeroRetentionConfirmed: boolean;
  zeroRetentionNote: string | null;
  zeroRetentionAt: Date | null;
  monthlyBudgetUsd: string | null;
  /** Whether the AI layer would actually run with what is saved. */
  ready: boolean;
  /** Why it is not ready, in the order somebody would fix them. */
  missing: string[];
  updatedAt: Date | null;
}

export interface UpdateAiSettings {
  provider?: SelectableProvider;
  model?: string;
  /** Write-only. Absent means "leave the stored key alone". */
  apiKey?: string;
  inputPricePerMTok?: string;
  outputPricePerMTok?: string;
  monthlyBudgetUsd?: string | null;
  zeroRetentionConfirmed?: boolean;
  zeroRetentionNote?: string;
}

const SINGLETON = 'singleton';

const TO_ENUM: Record<SelectableProvider, AiProviderName> = {
  anthropic: AiProviderName.ANTHROPIC,
  openai: AiProviderName.OPENAI,
  gemini: AiProviderName.GEMINI,
  deepseek: AiProviderName.DEEPSEEK,
};

const FROM_ENUM: Record<AiProviderName, SelectableProvider> = {
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai',
  GEMINI: 'gemini',
  DEEPSEEK: 'deepseek',
};

@Injectable()
export class AiSettingsService {
  private readonly logger = new Logger(AiSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
  ) {}

  /** What a settings screen may see. */
  async view(): Promise<AiSettingsView> {
    return this.toView(await this.row());
  }

  /**
   * The resolved configuration, key included.
   *
   * Only for the AI layer itself. Never routed anywhere near a response.
   */
  async resolved(): Promise<{
    provider: SelectableProvider;
    model: string;
    apiKey: string;
    inputPricePerMTok: number;
    outputPricePerMTok: number;
    zeroRetention: boolean;
    monthlyBudgetUsd: number | null;
  } | null> {
    const row = await this.row();

    if (
      !row?.provider ||
      !row.model ||
      !row.apiKeyEncrypted ||
      row.inputPricePerMTok === null ||
      row.outputPricePerMTok === null
    ) {
      return null;
    }

    let apiKey: string;
    try {
      apiKey = this.encryption.decrypt(row.apiKeyEncrypted);
    } catch (error) {
      // A key that cannot be decrypted means the encryption key changed. The
      // AI layer stays off rather than guessing, and the reason is in the log
      // rather than in a stream of 401s from the provider.
      this.logger.error(`Stored AI key could not be decrypted: ${String(error)}`);
      return null;
    }

    return {
      provider: FROM_ENUM[row.provider],
      model: row.model,
      apiKey,
      inputPricePerMTok: row.inputPricePerMTok.toNumber(),
      outputPricePerMTok: row.outputPricePerMTok.toNumber(),
      zeroRetention: row.zeroRetentionConfirmed,
      monthlyBudgetUsd: row.monthlyBudgetUsd?.toNumber() ?? null,
    };
  }

  async update(
    user: AuthenticatedUser,
    input: UpdateAiSettings,
  ): Promise<AiSettingsView> {
    const existing = await this.row();
    const provider = input.provider ?? (existing?.provider ? FROM_ENUM[existing.provider] : null);

    if (input.model !== undefined && provider === null) {
      throw new BadRequestException('Choose a provider before a model');
    }

    if (provider && input.model && !isKnownModel(provider, input.model)) {
      // Accepted, not refused: a clinic should not wait for a deploy to use a
      // model released last week. Logged so a typo is still findable.
      this.logger.warn(`Model ${input.model} is not in the catalogue for ${provider}`);
    }

    // Changing the provider is changing who holds the data. Whatever was
    // declared about the last one does not carry over.
    const providerChanged =
      input.provider !== undefined &&
      existing?.provider !== undefined &&
      existing?.provider !== null &&
      TO_ENUM[input.provider] !== existing.provider;

    const zeroRetention = providerChanged
      ? false
      : (input.zeroRetentionConfirmed ?? existing?.zeroRetentionConfirmed ?? false);

    const data = {
      provider: input.provider ? TO_ENUM[input.provider] : undefined,
      model: input.model,
      ...(input.apiKey === undefined
        ? {}
        : {
            apiKeyEncrypted: this.encryption.encrypt(input.apiKey),
            apiKeyLast4: input.apiKey.slice(-4),
          }),
      inputPricePerMTok: input.inputPricePerMTok,
      outputPricePerMTok: input.outputPricePerMTok,
      monthlyBudgetUsd: input.monthlyBudgetUsd,
      zeroRetentionConfirmed: zeroRetention,
      zeroRetentionNote: providerChanged ? null : input.zeroRetentionNote,
      zeroRetentionAt: zeroRetention && !existing?.zeroRetentionConfirmed ? new Date() : undefined,
      updatedById: user.id,
    };

    const saved = await this.prisma.aiSetting.upsert({
      where: { id: SINGLETON },
      create: { id: SINGLETON, ...data },
      update: data,
    });

    // Audited without the key, and without the last four either: an audit log
    // is read by more people than the settings screen is.
    await this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      action: AuditAction.UPDATE,
      entityType: 'ai_settings',
      entityId: SINGLETON,
      before: existing
        ? { provider: existing.provider, model: existing.model, zeroRetention: existing.zeroRetentionConfirmed }
        : undefined,
      after: {
        provider: saved.provider,
        model: saved.model,
        zeroRetention: saved.zeroRetentionConfirmed,
        apiKeyChanged: input.apiKey !== undefined,
        clearedByProviderChange: providerChanged,
      },
    });

    if (providerChanged) {
      this.logger.warn(
        'AI provider changed; the zero-retention declaration was cleared and must be made again',
      );
    }

    return this.toView(saved);
  }

  /** Wipes the configuration, which is how the AI layer is turned off. */
  async clear(user: AuthenticatedUser): Promise<AiSettingsView> {
    const saved = await this.prisma.aiSetting.upsert({
      where: { id: SINGLETON },
      create: { id: SINGLETON },
      update: {
        provider: null,
        model: null,
        apiKeyEncrypted: null,
        apiKeyLast4: null,
        inputPricePerMTok: null,
        outputPricePerMTok: null,
        zeroRetentionConfirmed: false,
        zeroRetentionNote: null,
        zeroRetentionAt: null,
        updatedById: user.id,
      },
    });

    await this.audit.record({
      actorId: user.id,
      actorRole: user.role,
      action: AuditAction.UPDATE,
      entityType: 'ai_settings',
      entityId: SINGLETON,
      after: { cleared: true },
    });

    return this.toView(saved);
  }

  private async row(): Promise<AiSetting | null> {
    return this.prisma.aiSetting.findUnique({ where: { id: SINGLETON } });
  }

  private toView(row: AiSetting | null): AiSettingsView {
    const provider = row?.provider ? FROM_ENUM[row.provider] : null;
    const missing: string[] = [];

    if (!provider) missing.push('provider');
    if (!row?.model) missing.push('model');
    if (!row?.apiKeyEncrypted) missing.push('apiKey');
    if (row?.inputPricePerMTok === null || row?.inputPricePerMTok === undefined) {
      missing.push('inputPricePerMTok');
    }
    if (row?.outputPricePerMTok === null || row?.outputPricePerMTok === undefined) {
      missing.push('outputPricePerMTok');
    }

    return {
      provider,
      model: row?.model ?? null,
      apiKeyLast4: row?.apiKeyLast4 ?? null,
      hasApiKey: Boolean(row?.apiKeyEncrypted),
      inputPricePerMTok: row?.inputPricePerMTok?.toString() ?? null,
      outputPricePerMTok: row?.outputPricePerMTok?.toString() ?? null,
      zeroRetentionConfirmed: row?.zeroRetentionConfirmed ?? false,
      zeroRetentionNote: row?.zeroRetentionNote ?? null,
      zeroRetentionAt: row?.zeroRetentionAt ?? null,
      monthlyBudgetUsd: row?.monthlyBudgetUsd?.toString() ?? null,
      // Ready to run is not the same as ready for clinical prompts: those also
      // need the zero-retention declaration, which the AI layer checks itself.
      ready: missing.length === 0,
      missing,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /** The catalogue a settings screen builds its pickers from. */
  catalogue(): typeof PROVIDERS {
    return PROVIDERS;
  }
}
