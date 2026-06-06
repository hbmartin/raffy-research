import { Result } from '@swan-io/boxed';

import { AppError } from '@/modules/kernel/domain/errors/app-error';

import type { LocalAiProviderName } from './config';
import {
  generateLocalText,
  type LocalAiNdjsonEvent,
} from './local-text-generator';
import type { ReportGeneratorPort } from '../../application/ports/report-generator';

export function createLocalAiReportGenerator(input: {
  provider: LocalAiProviderName;
  model: string;
  rawOutputDir: string;
  runId: string;
  abortSignal?: AbortSignal;
  action?: string;
  onEvent?: (event: LocalAiNdjsonEvent) => void | Promise<void>;
}): ReportGeneratorPort {
  let callCount = 0;

  return {
    async generate({ prompt }) {
      callCount += 1;
      try {
        const result = await generateLocalText({
          provider: input.provider,
          model: input.model,
          prompt,
          action: input.action ?? 'generate_report',
          label:
            callCount === 1 ? 'weekly-report' : `weekly-report-${callCount}`,
          runId: input.runId,
          rawOutputDir: input.rawOutputDir,
          abortSignal: input.abortSignal,
          onEvent: input.onEvent,
        });
        return Result.Ok({
          text: result.text,
          modelName: result.modelName,
          modelProvider: result.modelProvider,
          metadata: result.metadata,
        });
      } catch (error) {
        if (error instanceof AppError) return Result.Error(error);
        return Result.Error(
          new AppError({
            code: 'LOCAL_AI_REPORT_GENERATION_ERROR',
            category: 'system',
            status: 502,
            message: 'Local AI report generation failed',
            cause: error,
          })
        );
      }
    },
  };
}
