import { z } from 'zod';

import { ConfigurationError } from '@/modules/kernel/domain/errors/configuration-error';
import {
  baseEnvSchema,
  parseEnv,
  zNonEmptyEnvString,
} from '@/modules/kernel/infrastructure/config/env-schema';

import type { IntelligenceRuntimeConfig } from '../../application/ports/runtime-config';
import { defaultProviderCredentialRefs } from '../../domain/intelligence';

const optionalSecret = () => zNonEmptyEnvString().optional();

const intelligenceEnvSchema = baseEnvSchema.extend({
  AHREFS_API_KEY: optionalSecret(),
  APIFY_TOKEN: optionalSecret(),
  AWARIO_API_KEY: optionalSecret(),
  CRON_SECRET: optionalSecret(),
  DISTILL_API_KEY: optionalSecret(),
  EXA_API_KEY: optionalSecret(),
  FORUMSCOUT_API_KEY: optionalSecret(),
  NOTION_TOKEN: optionalSecret(),
  OPENAI_API_KEY: optionalSecret(),
  OPENAI_MODEL: zNonEmptyEnvString().default('gpt-5.4-mini'),
  PROVIDER_CALLBACK_SECRET: optionalSecret(),
  SEMRUSH_API_KEY: optionalSecret(),
  SLACK_ALERT_WEBHOOK_URL: z.url().optional(),
  SLACK_BOT_TOKEN: optionalSecret(),
  TRIGIFY_API_KEY: optionalSecret(),
  VISUALPING_API_KEY: optionalSecret(),
});

export function getIntelligenceRuntimeConfig(options?: {
  requireCronSecret?: boolean;
  requireOpenAi?: boolean;
  requireProviderCallbackSecret?: boolean;
}): IntelligenceRuntimeConfig {
  const env = parseEnv(intelligenceEnvSchema);

  if (options?.requireCronSecret && !env.CRON_SECRET) {
    throw new ConfigurationError('CRON_SECRET is required for cron routes.');
  }

  if (options?.requireOpenAi && !env.OPENAI_API_KEY) {
    throw new ConfigurationError(
      'OPENAI_API_KEY is required to generate intelligence reports.'
    );
  }

  if (options?.requireProviderCallbackSecret && !env.PROVIDER_CALLBACK_SECRET) {
    throw new ConfigurationError(
      'PROVIDER_CALLBACK_SECRET is required for intelligence provider callbacks.'
    );
  }

  const envRecord = env as Record<string, unknown>;
  const providerCredentials = Object.values(
    defaultProviderCredentialRefs
  ).reduce<Record<string, string>>((credentials, envName) => {
    const value = envRecord[envName];
    if (typeof value === 'string') credentials[envName] = value;
    return credentials;
  }, {});

  return {
    cronSecret: env.CRON_SECRET,
    openAiApiKey: env.OPENAI_API_KEY,
    openAiModel: env.OPENAI_MODEL,
    providerCallbackSecret: env.PROVIDER_CALLBACK_SECRET,
    providerCredentials,
    slackAlertWebhookUrl: env.SLACK_ALERT_WEBHOOK_URL,
  };
}
