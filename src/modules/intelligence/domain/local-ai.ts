import type { JsonObject } from '@/modules/kernel/domain/json';

export const LOCAL_AI_PROVIDERS = [
  'codex-cli',
  'claude-code',
  'ollama',
] as const;

export type LocalAiProviderName = (typeof LOCAL_AI_PROVIDERS)[number];

/**
 * Known-good models per provider, first one preferred. Suggestions only: model
 * names change faster than this list and Ollama runs whatever is pulled
 * locally, so any other name is still accepted.
 */
export const LOCAL_AI_MODEL_SUGGESTIONS: Record<
  LocalAiProviderName,
  readonly string[]
> = {
  'codex-cli': ['gpt-5-codex'],
  'claude-code': [
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-4-5-20251001',
    'claude-fable-5-1',
  ],
  ollama: ['qwen3:14b'],
};

/** The model a provider starts with when picked; empty means env default. */
export const defaultModelFor = (provider: LocalAiProviderName): string =>
  LOCAL_AI_MODEL_SUGGESTIONS[provider][0] ?? '';

export type LocalAiConfig = {
  provider: LocalAiProviderName;
  model: string;
  rawOutputDir: string;
  timeoutMs: number;
  ollamaBaseUrl: string;
  ollamaNumCtx?: number;
};

export type LocalAiNdjsonEvent =
  | {
      type: 'start';
      runId: string;
      action: string;
      provider: LocalAiProviderName;
      model: string;
      label?: string;
      message?: string;
      at: string;
    }
  | {
      type: 'step';
      runId: string;
      action: string;
      label: string;
      message: string;
      at: string;
      data?: JsonObject;
    }
  | {
      type: 'tool_event';
      runId: string;
      action: string;
      label: string;
      event: JsonObject;
      at: string;
    }
  | {
      type: 'artifact';
      runId: string;
      action: string;
      label: string;
      artifact: JsonObject;
      at: string;
    }
  | {
      type: 'error';
      runId: string;
      action: string;
      label?: string;
      message: string;
      at: string;
      data?: JsonObject;
    }
  | {
      type: 'done';
      runId: string;
      action: string;
      label?: string;
      at: string;
      data?: JsonObject;
    };

export type LocalTextGenerationInput = {
  provider: LocalAiProviderName;
  model: string;
  prompt: string;
  action: string;
  label: string;
  runId: string;
  rawOutputDir: string;
  ollamaBaseUrl?: string;
  ollamaNumCtx?: number;
  /** Pinned to 0 by judges, where run-to-run variance is the enemy. */
  temperature?: number;
  abortSignal?: AbortSignal;
  onEvent?: (event: LocalAiNdjsonEvent) => void | Promise<void>;
};

export type LocalTextGenerationResult = {
  text: string;
  modelName: string;
  modelProvider: LocalAiProviderName;
  metadata: JsonObject;
};

export type LocalTextGenerator = (
  input: LocalTextGenerationInput
) => Promise<LocalTextGenerationResult>;
