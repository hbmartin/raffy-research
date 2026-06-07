import type { JsonObject } from '@/modules/kernel/domain/json';

export const LOCAL_AI_PROVIDERS = ['codex-cli', 'claude-code'] as const;

export type LocalAiProviderName = (typeof LOCAL_AI_PROVIDERS)[number];

export type LocalAiConfig = {
  provider: LocalAiProviderName;
  model: string;
  rawOutputDir: string;
  timeoutMs: number;
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
