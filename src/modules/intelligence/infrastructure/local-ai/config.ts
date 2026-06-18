import { z } from 'zod';

import {
  baseEnvSchema,
  parseEnv,
} from '@/modules/kernel/infrastructure/config/env-schema';

import { LOCAL_AI_PROVIDERS, type LocalAiConfig } from '../../domain/local-ai';

const localAiEnvSchema = baseEnvSchema.extend({
  LOCAL_AI_PROVIDER: z.enum(LOCAL_AI_PROVIDERS).default('codex-cli'),
  LOCAL_AI_MODEL: z.string().trim().min(1).default('gpt-5-codex'),
  LOCAL_AI_RAW_OUTPUT_DIR: z.string().trim().min(1).default('.local-ai-runs'),
  LOCAL_AI_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  OLLAMA_BASE_URL: z
    .string()
    .trim()
    .url()
    .default('http://localhost:11434/api'),
});

export function getLocalAiConfig(): LocalAiConfig {
  const env = parseEnv(localAiEnvSchema);
  return {
    provider: env.LOCAL_AI_PROVIDER,
    model: env.LOCAL_AI_MODEL,
    rawOutputDir: env.LOCAL_AI_RAW_OUTPUT_DIR,
    timeoutMs: env.LOCAL_AI_TIMEOUT_MS,
    ollamaBaseUrl: env.OLLAMA_BASE_URL,
  };
}
