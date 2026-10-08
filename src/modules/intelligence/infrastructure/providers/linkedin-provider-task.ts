import { Result } from '@swan-io/boxed';
import { z } from 'zod';

import { AppError } from '@/modules/kernel/domain/errors/app-error';

import { fetchJson } from './http';
import type {
  LinkedinProviderTask,
  LinkedinTaskReference,
} from '../../application/ports/linkedin-monitoring';
import { normalizeLinkedinUrl } from '../../domain/linkedin-monitoring';

const taskInputSchema = z.object({ targetUrls: z.array(z.string()) });
const scheduleSchema = z.object({
  data: z.object({
    isEnabled: z.boolean(),
    cronExpression: z.string().optional(),
    timezone: z.string().optional(),
    actions: z.array(
      z.object({
        type: z.string(),
        actorTaskId: z.string().optional(),
        input: z.record(z.string(), z.unknown()).optional().nullable(),
      })
    ),
  }),
});

export function createLinkedinProviderTask(options: {
  getCredential: (ref: string | null) => string | undefined;
}): LinkedinProviderTask {
  function headers(
    reference: LinkedinTaskReference
  ): Result<Record<string, string>, AppError> {
    const token = options.getCredential(reference.credentialsRef);
    return token
      ? Result.Ok({
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        })
      : Result.Error(
          new AppError({
            code: 'LINKEDIN_CREDENTIAL_MISSING',
            category: 'system',
            status: 500,
            message: 'The configured Apify credential is unavailable.',
          })
        );
  }
  return {
    async inspect(reference) {
      const auth = headers(reference);
      if (auth.isError()) return Result.Error(auth.getError());
      const response = await fetchJson(
        'apify',
        `https://api.apify.com/v2/actor-tasks/${encodeURIComponent(reference.taskId)}/input`,
        { headers: auth.get() }
      );
      if (response.isError()) return Result.Error(response.getError());
      const input = taskInputSchema.safeParse(response.get());
      if (!input.success)
        return Result.Ok({
          type: 'provider_configuration_invalid',
          reason: 'Apify task input must contain a targetUrls array.',
        });
      const targets = input.data.targetUrls.map((url) =>
        normalizeLinkedinUrl(url)
      );
      if (targets.some((url) => !url))
        return Result.Ok({
          type: 'provider_configuration_invalid',
          reason:
            'Apify contains targets that are not supported LinkedIn person or company URLs.',
        });
      let schedule;
      if (reference.scheduleId) {
        const scheduled = await fetchJson(
          'apify',
          `https://api.apify.com/v2/schedules/${encodeURIComponent(reference.scheduleId)}`,
          { headers: auth.get() }
        );
        if (scheduled.isError()) return Result.Error(scheduled.getError());
        const parsed = scheduleSchema.safeParse(scheduled.get());
        if (!parsed.success)
          return Result.Ok({
            type: 'provider_configuration_invalid',
            reason: 'Apify schedule response is invalid.',
          });
        const actions = parsed.data.data.actions.filter(
          (action) =>
            action.type === 'RUN_ACTOR_TASK' &&
            action.actorTaskId === reference.taskId
        );
        if (
          !actions.length ||
          actions.some(
            (action) =>
              action.input && Object.hasOwn(action.input, 'targetUrls')
          )
        )
          return Result.Ok({
            type: 'provider_configuration_invalid',
            reason:
              'The configured schedule must run this task without overriding targetUrls.',
          });
        schedule = {
          enabled: parsed.data.data.isEnabled,
          cronExpression: parsed.data.data.cronExpression,
          timezone: parsed.data.data.timezone,
        };
      }
      return Result.Ok({
        type: 'task_inspected',
        state: {
          targets: targets as string[],
          ...(schedule ? { schedule } : {}),
        },
      });
    },
    async updateTargets(reference, targets) {
      const auth = headers(reference);
      if (auth.isError()) return Result.Error(auth.getError());
      // Apify PUT merges input properties; omitted scrape settings are preserved.
      const response = await fetchJson(
        'apify',
        `https://api.apify.com/v2/actor-tasks/${encodeURIComponent(reference.taskId)}/input`,
        {
          method: 'PUT',
          headers: auth.get(),
          body: JSON.stringify({ targetUrls: targets }),
        }
      );
      return response.isError()
        ? Result.Error(response.getError())
        : Result.Ok({ type: 'targets_updated' });
    },
  };
}
