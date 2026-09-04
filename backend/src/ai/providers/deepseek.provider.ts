import type { AIProvider, FetchLike } from '../ai-provider';
import { OpenAIProvider } from './openai.provider';

/**
 * DeepSeek, which speaks OpenAI's protocol.
 *
 * The whole implementation is a base URL, which is the seam working as
 * intended: a provider that differs only in where the request goes should not
 * need a second copy of the request.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE DATA GOES
 *
 * DeepSeek's API is operated from China, and its standard terms allow the
 * prompts sent to it to be retained and used for training. For a clinic
 * processing patient data under KVKK and GDPR that is a transfer and a
 * retention decision, not a technical preference.
 *
 * Nothing here decides that. What this codebase does is refuse to send a
 * clinical prompt to any provider until somebody has recorded a zero-retention
 * agreement **for that provider** — see `AiSetting.zeroRetentionConfirmed`,
 * which is cleared whenever the provider changes.
 * ---------------------------------------------------------------------------
 */
export class DeepSeekProvider extends OpenAIProvider implements AIProvider {
  override readonly name = 'deepseek' as const;

  constructor(model: string, apiKey: string, fetchImpl: FetchLike) {
    super(model, apiKey, fetchImpl, {
      endpoint: 'https://api.deepseek.com/chat/completions',
      label: 'DeepSeek',
    });
  }
}
