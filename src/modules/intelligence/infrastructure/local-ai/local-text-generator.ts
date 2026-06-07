import { streamText } from 'ai';
import { createClaudeCode } from 'ai-sdk-provider-claude-code';
import { createCodexCli } from 'ai-sdk-provider-codex-cli';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { JsonObject, JsonValue } from '@/modules/kernel/domain/json';

import type {
  LocalAiProviderName,
  LocalTextGenerationInput,
  LocalTextGenerationResult,
} from '../../domain/local-ai';

const nowIso = () => new Date().toISOString();

const safeFileSegment = (value: string) =>
  value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'generation';

function toJsonValue(value: unknown): JsonValue {
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}

function toJsonObject(value: unknown): JsonObject {
  const json = toJsonValue(value);
  return json && typeof json === 'object' && !Array.isArray(json)
    ? json
    : { value: json };
}

function createModel(provider: LocalAiProviderName, model: string) {
  if (provider === 'codex-cli') {
    const codex = createCodexCli({
      defaultSettings: {
        approvalMode: 'never',
        sandboxMode: 'read-only',
        skipGitRepoCheck: true,
        allowNpx: false,
        cwd: process.cwd(),
        logger: false,
      },
    });
    return codex(model);
  }

  const claude = createClaudeCode({
    defaultSettings: {
      allowedTools: [],
      disallowedTools: [
        'Bash',
        'Edit',
        'Glob',
        'Grep',
        'LS',
        'MultiEdit',
        'NotebookEdit',
        'Read',
        'WebFetch',
        'WebSearch',
        'Write',
      ],
      permissionMode: 'dontAsk',
      settingSources: [],
      cwd: process.cwd(),
      logger: false,
      streamingInput: 'auto',
    },
  });
  return claude(model);
}

async function writeRawOutput(input: {
  runId: string;
  rawOutputDir: string;
  label: string;
  payload: JsonObject;
}) {
  const directory = path.resolve(
    process.cwd(),
    input.rawOutputDir,
    input.runId
  );
  await mkdir(directory, { recursive: true });
  const filePath = path.join(
    directory,
    `${Date.now()}-${randomUUID()}-${safeFileSegment(input.label)}.json`
  );
  await writeFile(filePath, JSON.stringify(input.payload, null, 2), 'utf8');
  return path.relative(process.cwd(), filePath);
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof AppError) throw reason;
  throw new AppError({
    code: 'LOCAL_AI_GENERATION_ABORTED',
    category: 'system',
    status: 499,
    message:
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Local AI generation aborted',
    cause: reason,
  });
}

export async function generateLocalText(
  input: LocalTextGenerationInput
): Promise<LocalTextGenerationResult> {
  const rawEvents: JsonValue[] = [];
  const toolEvents: JsonObject[] = [];
  let text = '';
  let rawFilePath: string | null = null;

  try {
    await input.onEvent?.({
      type: 'start',
      runId: input.runId,
      action: input.action,
      provider: input.provider,
      model: input.model,
      label: input.label,
      message: 'local_model_call_started',
      at: nowIso(),
    });

    await input.onEvent?.({
      type: 'step',
      runId: input.runId,
      action: input.action,
      label: input.label,
      message: 'local_model_call_started',
      at: nowIso(),
    });

    throwIfAborted(input.abortSignal);

    const result = streamText({
      model: createModel(input.provider, input.model),
      prompt: input.prompt,
      includeRawChunks: true,
      abortSignal: input.abortSignal,
    });

    for await (const part of result.fullStream) {
      throwIfAborted(input.abortSignal);
      rawEvents.push(toJsonValue(part));

      if (part.type === 'text-delta') {
        text += part.text;
        continue;
      }

      if (part.type === 'start-step' || part.type === 'finish-step') {
        await input.onEvent?.({
          type: 'step',
          runId: input.runId,
          action: input.action,
          label: input.label,
          message: part.type,
          at: nowIso(),
          data: toJsonObject(part),
        });
        continue;
      }

      if (
        part.type === 'tool-input-start' ||
        part.type === 'tool-input-delta' ||
        part.type === 'tool-input-end' ||
        part.type === 'tool-call' ||
        part.type === 'tool-result' ||
        part.type === 'tool-error' ||
        part.type === 'tool-output-denied' ||
        part.type === 'source' ||
        part.type === 'raw'
      ) {
        const event = toJsonObject(part);
        toolEvents.push(event);
        await input.onEvent?.({
          type: 'tool_event',
          runId: input.runId,
          action: input.action,
          label: input.label,
          event,
          at: nowIso(),
        });
        continue;
      }

      if (part.type === 'error') {
        throw part.error;
      }
    }

    rawFilePath = await writeRawOutput({
      runId: input.runId,
      rawOutputDir: input.rawOutputDir,
      label: input.label,
      payload: {
        provider: input.provider,
        model: input.model,
        label: input.label,
        prompt: input.prompt,
        text,
        rawEvents,
        toolEvents,
      },
    });

    const metadata: JsonObject = {
      rawFilePath,
      toolEvents,
      rawEventCount: rawEvents.length,
    };

    await input.onEvent?.({
      type: 'artifact',
      runId: input.runId,
      action: input.action,
      label: input.label,
      artifact: {
        kind: 'raw_model_output',
        path: rawFilePath,
        toolEventCount: toolEvents.length,
      },
      at: nowIso(),
    });

    await input.onEvent?.({
      type: 'done',
      runId: input.runId,
      action: input.action,
      label: input.label,
      at: nowIso(),
      data: {
        status: 'local_model_call_completed',
        rawFilePath,
        rawEventCount: rawEvents.length,
        toolEventCount: toolEvents.length,
      },
    });

    return {
      text,
      modelName: input.model,
      modelProvider: input.provider,
      metadata,
    };
  } catch (error) {
    rawFilePath = await writeRawOutput({
      runId: input.runId,
      rawOutputDir: input.rawOutputDir,
      label: `${input.label}-error`,
      payload: {
        provider: input.provider,
        model: input.model,
        label: input.label,
        prompt: input.prompt,
        text,
        rawEvents,
        toolEvents,
        error: error instanceof Error ? error.message : String(error),
      },
    }).catch(() => null);

    await Promise.resolve(
      input.onEvent?.({
        type: 'error',
        runId: input.runId,
        action: input.action,
        label: input.label,
        message:
          error instanceof Error ? error.message : 'Local AI generation failed',
        at: nowIso(),
        data: rawFilePath ? { rawFilePath } : undefined,
      })
    ).catch(() => undefined);

    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError({
      code: 'LOCAL_AI_GENERATION_ERROR',
      category: 'system',
      status: 502,
      message:
        error instanceof Error ? error.message : 'Local AI generation failed',
      cause: error,
      details: rawFilePath ? { rawFilePath } : undefined,
    });
  }
}
