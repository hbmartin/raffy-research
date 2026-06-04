import { z } from 'zod';

import { ConfigurationError } from '@/modules/kernel/domain/errors/configuration-error';
import {
  baseEnvSchema,
  parseEnv,
  zNonEmptyEnvString,
} from '@/modules/kernel/infrastructure/config/env-schema';

import type { ProviderName } from '../../domain/intelligence';

export const defaultProviderCredentialRefs = {
  ahrefs: 'AHREFS_API_KEY',
  apify: 'APIFY_TOKEN',
  awario: 'AWARIO_API_KEY',
  distill: 'DISTILL_API_KEY',
  exa: 'EXA_API_KEY',
  forumscout: 'FORUMSCOUT_API_KEY',
  notion: 'NOTION_TOKEN',
  semrush: 'SEMRUSH_API_KEY',
  slack: 'SLACK_BOT_TOKEN',
  trigify: 'TRIGIFY_API_KEY',
  visualping: 'VISUALPING_API_KEY',
} satisfies Record<ProviderName, string>;

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
  SEMRUSH_API_KEY: optionalSecret(),
  SLACK_ALERT_WEBHOOK_URL: z.url().optional(),
  SLACK_BOT_TOKEN: optionalSecret(),
  TRIGIFY_API_KEY: optionalSecret(),
  VISUALPING_API_KEY: optionalSecret(),
});

export type IntelligenceRuntimeConfig = {
  cronSecret?: string;
  openAiApiKey?: string;
  openAiModel: string;
  providerCredentials: Partial<Record<string, string>>;
  slackAlertWebhookUrl?: string;
};

export function getIntelligenceRuntimeConfig(options?: {
  requireCronSecret?: boolean;
  requireOpenAi?: boolean;
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
    providerCredentials,
    slackAlertWebhookUrl: env.SLACK_ALERT_WEBHOOK_URL,
  };
}
