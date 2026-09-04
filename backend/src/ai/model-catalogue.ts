import type { SelectableProvider } from './ai-provider';

/**
 * The models a clinic can pick from, and where to look up what they cost.
 *
 * ---------------------------------------------------------------------------
 * THERE ARE NO PRICES IN HERE, ON PURPOSE.
 *
 * The budget guard spends real money against whatever number it is given, and
 * a price written into a repository is stale within a quarter while still
 * looking authoritative. Worse, it would be *believed* — the number would sit
 * in a settings screen with no indication that nobody had checked it since the
 * day it was typed.
 *
 * So the catalogue carries the model identifiers and a link to each provider's
 * own pricing page, and the price is a field the operator fills in. An
 * unpriced model does not get enabled; that rule already exists and is
 * deliberately not softened here.
 * ---------------------------------------------------------------------------
 *
 * The identifiers themselves also move. `isKnown` is advisory: a model not on
 * this list is accepted, because a clinic should not have to wait for a deploy
 * to use a model released last week.
 */

export interface ProviderInfo {
  id: SelectableProvider;
  label: string;
  /** Suggested models, newest-capable first. Not a closed list. */
  models: string[];
  /** Where the operator reads the current price. */
  pricingUrl: string;
  /** Where the operator gets a key. */
  consoleUrl: string;
  /**
   * What the clinic has to satisfy itself about before clinical prompts are
   * allowed. Shown beside the zero-retention checkbox, in the operator's own
   * language, because "I agree" against an unread sentence is not a record.
   */
  retentionNote: string;
}

export const PROVIDERS: Record<SelectableProvider, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    // 2026-09-04'te sağlayıcı belgelerinden doğrulandı. Kimlikler tarih eki
    // ALMAZ — 'claude-haiku-4-5-20251001' gibi bir sürüm damgası 404 döner.
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    pricingUrl: 'https://www.anthropic.com/pricing',
    consoleUrl: 'https://console.anthropic.com/',
    retentionNote:
      'Anthropic API varsayılan olarak istemleri model eğitimi için kullanmaz. ' +
      'Sağlık verisi için ayrıca bir iş ortaklığı/veri işleme sözleşmesi gerekir. ' +
      'NOT: Claude Fable ailesi (claude-fable-5-1) 30 günlük saklama zorunlu ' +
      'tuttuğu için sıfır saklama ile KULLANILAMAZ; bu yüzden listede yok.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (GPT)',
    // 2026-09-04'te developers.openai.com/api/docs/models'ten doğrulandı.
    models: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
    pricingUrl: 'https://openai.com/api/pricing/',
    consoleUrl: 'https://platform.openai.com/api-keys',
    retentionNote:
      'OpenAI API istemleri varsayılan olarak eğitim için kullanmaz ama bir süre saklar. ' +
      'Sıfır saklama (zero data retention) ayrıca talep edilip onaylanmalıdır.',
  },
  gemini: {
    id: 'gemini',
    label: 'Google (Gemini)',
    // 2026-09-04'te ai.google.dev/gemini-api/docs/models'ten doğrulandı.
    // Yalnız kararlı sürümler; preview/experimental hasta verisiyle kullanılmaz.
    models: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-2.5-pro'],
    pricingUrl: 'https://ai.google.dev/pricing',
    consoleUrl: 'https://aistudio.google.com/apikey',
    retentionNote:
      'Google AI Studio ÜCRETSİZ katmanı istemleri ürün geliştirme için kullanır — ' +
      'hasta verisi için uygun değildir. Ücretli katman veya Vertex AI kullanılmalı ' +
      've veri işleme şartları ayrıca onaylanmalıdır.',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    // 2026-09-04'te api-docs.deepseek.com'dan doğrulandı.
    models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    pricingUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    retentionNote:
      'DİKKAT: DeepSeek API Çin’de barındırılır ve standart şartları istemleri ' +
      'saklamaya ve eğitimde kullanmaya izin verir. KVKK/GDPR kapsamında bu bir ' +
      'yurt dışına veri aktarımı kararıdır; hasta verisi göndermeden önce hukuki ' +
      'değerlendirme ve ayrı bir sözleşme gerekir.',
  },
};

export function isKnownModel(provider: SelectableProvider, model: string): boolean {
  return PROVIDERS[provider].models.includes(model);
}
