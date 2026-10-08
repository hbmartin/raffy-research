import { createOpenAI } from '@ai-sdk/openai';
import { Result } from '@swan-io/boxed';
import { APICallError, generateText, RetryError } from 'ai';

import { AppError } from '@/modules/kernel/domain/errors/app-error';

import { getOpenAiConfig } from '../config/runtime';
import type { ReportGeneratorPort } from '../../application/ports/report-generator';
import { safeFailureDiagnostics } from '../../application/safe-diagnostics';

function normalizeFailure(error: unknown): {
  error: unknown;
  upstreamStatus?: number;
  requestId?: string;
} {
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (APICallError.isInstance(current)) {
      return {
        error: current,
        upstreamStatus: current.statusCode,
        requestId: current.responseHeaders?.['x-request-id'],
      };
    }
    if (RetryError.isInstance(current)) current = current.lastError;
    else if (current instanceof Error && current.cause !== undefined)
      current = current.cause;
    else break;
  }
  return { error };
}

/** OpenAI-backed report generator using the AI SDK. */
export function createOpenAiReportGenerator(options?: {
  model?: string;
  signal?: AbortSignal;
}): ReportGeneratorPort {
  return {
    async generate({ prompt, stage = 'initial' }) {
      const startedAt = Date.now();
      let model: string | undefined;
      try {
        const config = getOpenAiConfig();
        model = options?.model ?? config.model;
        const openai = createOpenAI({ apiKey: config.apiKey });
        const { text } = await generateText({
          model: openai(model),
          abortSignal: options?.signal,
          maxRetries: 0,
          prompt,
          experimental_telemetry: { isEnabled: true },
        });
        return Result.Ok({
          text,
          modelName: model,
          modelProvider: 'openai',
        });
      } catch (error) {
        if (error instanceof AppError) return Result.Error(error);
        return Result.Error(
          new AppError({
            code: 'OPENAI_GENERATION_ERROR',
            category: 'system',
            status: 502,
            message: 'OpenAI report generation failed',
            details: safeFailureDiagnostics({
              ...normalizeFailure(error),
              stage,
              provider: 'openai',
              model,
              durationMs: Date.now() - startedAt,
            }),
          })
        );
      }
    },
  };
}
