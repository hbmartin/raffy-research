import { createOpenAI } from '@ai-sdk/openai';
import { Result } from '@swan-io/boxed';
import { generateText } from 'ai';

import { AppError } from '@/modules/kernel/domain/errors/app-error';

import type { NewsletterModel } from '../application/ports';

export function createHostedNewsletterModel(input: {
  apiKey: () => string | undefined;
}): NewsletterModel {
  return {
    async generate({ runtime, prompt, signal, deadline }) {
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
          maxOutputTokens: 4096,
          abortSignal: AbortSignal.any([
            AbortSignal.timeout(
              Math.max(
                1,
                Math.min(
                  100_000,
                  deadline ? deadline.getTime() - Date.now() : Infinity
                )
              )
            ),
            ...(signal ? [signal] : []),
          ]),
        });
        return Result.Ok(result.text);
      } catch (cause) {
        return Result.Error(
          new AppError({
            code: 'NEWSLETTER_MODEL_FAILED',
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
