/* oxlint-disable no-process-env */
import { AppError } from '@/modules/kernel/domain/errors/app-error';

import type { IntelligenceRuntimeConfig } from '../../application/ports/runtime-config';

const readEnv = (key: string): string | undefined => {
  const value = process.env[key];
  return value && value.trim() ? value.trim() : undefined;
};

export type OpenAiConfig = {
  apiKey: string;
  model: string;
};

/** OpenAI configuration. Throws when the API key is missing (generation cannot run). */
export function getOpenAiConfig(): OpenAiConfig {
  const apiKey = readEnv('OPENAI_API_KEY');
  if (!apiKey) {
    throw new AppError({
      code: 'OPENAI_NOT_CONFIGURED',
      category: 'system',
      status: 500,
      message: 'OPENAI_API_KEY is required for report generation.',
    });
  }
  return { apiKey, model: readEnv('OPENAI_MODEL') ?? 'gpt-4.1' };
}

/** The shared secret cron routes require in the Authorization bearer header. */
export function getCronSecret(): string | undefined {
  return readEnv('CRON_SECRET');
}

/** Optional Slack incoming-webhook URL for internal failure alerts. */
export function getSlackAlertWebhookUrl(): string | undefined {
  return readEnv('SLACK_ALERT_WEBHOOK_URL');
}

/** Resolve a provider credential from the environment by its configured ref. */
export function getProviderCredential(ref: string | null): string | undefined {
  if (!ref) return undefined;
  return readEnv(ref);
}

export function createIntelligenceRuntimeConfig(): IntelligenceRuntimeConfig {
  return {
    cronSecret: getCronSecret(),
    openAiApiKey: readEnv('OPENAI_API_KEY'),
    openAiModel: readEnv('OPENAI_MODEL') ?? 'gpt-4.1',
    slackAlertWebhookUrl: getSlackAlertWebhookUrl(),
    getProviderCredential,
  };
}
