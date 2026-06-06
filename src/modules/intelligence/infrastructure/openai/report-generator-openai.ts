import { createOpenAI } from '@ai-sdk/openai';
import { Result } from '@swan-io/boxed';
import { generateText } from 'ai';

import { AppError } from '@/modules/kernel/domain/errors/app-error';

import { getOpenAiConfig } from '../config/runtime';
import type { ReportGeneratorPort } from '../../application/ports/report-generator';

/** OpenAI-backed report generator using the AI SDK. */
export function createOpenAiReportGenerator(): ReportGeneratorPort {
  return {
    async generate({ prompt }) {
      try {
        const config = getOpenAiConfig();
        const openai = createOpenAI({ apiKey: config.apiKey });
        const { text } = await generateText({
          model: openai(config.model),
          prompt,
        });
        return Result.Ok({
          text,
          modelName: config.model,
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
            cause: error,
          })
        );
      }
    },
  };
}
