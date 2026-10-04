import { createOpenAI } from '@ai-sdk/openai';
import { Result } from '@swan-io/boxed';
import { generateText } from 'ai';

import { AppError } from '@/modules/kernel/domain/errors/app-error';

import type { NewsletterModel } from '../application/ports';

export function createHostedNewsletterModel(input: {
  apiKey: () => string | undefined;
  measure?: (details: Record<string, unknown>) => void;
}): NewsletterModel {
  return {
    async generate({
      runtime,
      prompt,
      signal,
      maxOutputTokens = 4096,
      timeoutMs = 600_000,
      jobId,
      stage,
    }) {
      const timeout = AbortSignal.timeout(timeoutMs);
      try {
        const key = input.apiKey();
        if (!key)
          return Result.Error(
            new AppError({
              code: 'NEWSLETTER_HOSTED_NOT_CONFIGURED',
              category: 'system',
              status: 503,
              message: 'Hosted AI is not configured',
            })
          );
        const result = await generateText({
          model: createOpenAI({ apiKey: key })(runtime.model),
          prompt,
          maxRetries: 0,
          maxOutputTokens,
          abortSignal: AbortSignal.any([timeout, ...(signal ? [signal] : [])]),
        });
        input.measure?.({
          jobId,
          stage,
          model: runtime.model,
          provider: runtime.provider,
          usage: result.usage,
          finishReason: result.finishReason,
        });
        if (result.finishReason === 'length')
          return Result.Error(
            new AppError({
              code: 'NEWSLETTER_OUTPUT_LIMIT',
              category: 'system',
              status: 422,
              message:
                'The response token cap was exhausted. Increase the response cap or use a larger context, then Retry.',
              details: {
                maxOutputTokens,
                partialText: result.text,
                usage: result.usage,
                finishReason: result.finishReason,
              },
            })
          );
        return Result.Ok(result.text);
      } catch (cause) {
        if (signal?.aborted && signal.reason instanceof AppError)
          return Result.Error(signal.reason);
        return Result.Error(
          new AppError({
            code: timeout.aborted
              ? 'NEWSLETTER_PROVIDER_TIMEOUT'
              : 'NEWSLETTER_MODEL_FAILED',
            category: 'system',
            status: 502,
            message: 'Hosted newsletter generation failed',
            cause,
          })
        );
      }
    },
  };
}
