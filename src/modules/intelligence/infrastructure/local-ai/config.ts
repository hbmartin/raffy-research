import { z } from 'zod';

import {
  baseEnvSchema,
  parseEnv,
} from '@/modules/kernel/infrastructure/config/env-schema';

export const LOCAL_AI_PROVIDERS = ['codex-cli', 'claude-code'] as const;

export type LocalAiProviderName = (typeof LOCAL_AI_PROVIDERS)[number];

const localAiEnvSchema = baseEnvSchema.extend({
  LOCAL_AI_PROVIDER: z.enum(LOCAL_AI_PROVIDERS).default('codex-cli'),
  LOCAL_AI_MODEL: z.string().trim().min(1).default('gpt-5-codex'),
  LOCAL_AI_RAW_OUTPUT_DIR: z.string().trim().min(1).default('.local-ai-runs'),
});

export type LocalAiConfig = {
  provider: LocalAiProviderName;
  model: string;
  rawOutputDir: string;
};

export function getLocalAiConfig(): LocalAiConfig {
  const env = parseEnv(localAiEnvSchema);
  return {
    provider: env.LOCAL_AI_PROVIDER,
    model: env.LOCAL_AI_MODEL,
    rawOutputDir: env.LOCAL_AI_RAW_OUTPUT_DIR,
  };
}
