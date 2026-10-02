import { Result } from '@swan-io/boxed';

import {
  createPublicResearchArchive,
  generateLocalText,
  getLocalAiConfig,
} from '@/modules/intelligence/backend';
import { createIntelligenceRuntimeConfig } from '@/modules/intelligence/backend';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import {
  createNewsletterUseCases,
  createNewsletterWorker,
  type NewsletterModel,
} from '@/modules/newsletter';
import {
  createHostedNewsletterModel,
  createNewsletterRepository,
} from '@/modules/newsletter/backend';
import { envClient } from '@/platform/env/client';

import { getKernel } from './kernel';

export function getNewsletterRuntime() {
  const kernel = getKernel();
  const repository = createNewsletterRepository(kernel.db);
  const archive = createPublicResearchArchive(kernel.db);
  const hosted = createHostedNewsletterModel({
    apiKey: () => createIntelligenceRuntimeConfig().openAiApiKey,
  });
  const model: NewsletterModel = {
    async generate(input) {
      if (input.runtime.mode === 'hosted') return hosted.generate(input);
      if (!envClient.DEV || input.runtime.provider === 'openai')
        return Result.Error(
          new AppError({
            code: 'LOCAL_NEWSLETTER_UNAVAILABLE',
            category: 'system',
            status: 503,
            message: 'Local newsletter generation requires the local app',
          })
        );
      try {
        const config = getLocalAiConfig();
        const output = await generateLocalText({
          provider: input.runtime.provider,
          model: input.runtime.model,
          prompt: input.prompt,
          action: 'newsletter',
          label: input.stage,
          runId: input.jobId,
          rawOutputDir: config.rawOutputDir,
          ollamaBaseUrl: config.ollamaBaseUrl,
          ollamaNumCtx: config.ollamaNumCtx,
          abortSignal: AbortSignal.timeout(config.timeoutMs),
        });
        return Result.Ok(output.text);
      } catch (cause) {
        return Result.Error(
          new AppError({
            code: 'LOCAL_NEWSLETTER_FAILED',
            category: 'system',
            status: 502,
            message: 'Local CLI newsletter generation failed',
            cause,
          })
        );
      }
    },
  };
  const worker = createNewsletterWorker({
    repository,
    archive,
    model,
    clock: kernel.clock,
    idGenerator: kernel.idGenerator,
  });
  const useCases = createNewsletterUseCases({
    repository,
    archive,
    permissionChecker: kernel.permissionChecker,
    clock: kernel.clock,
    idGenerator: kernel.idGenerator,
  });
  return { repository, archive, worker, useCases };
}

let localDraining = false;
export const newsletterPublicationNotifier = {
  async published(input: { workspaceId: string }) {
    const result = await getNewsletterRuntime().worker.reconcile(
      input.workspaceId
    );
    return result.map((outcome) => ({
      type:
        outcome.type === 'enqueued'
          ? ('notification_queued' as const)
          : ('notification_skipped' as const),
    }));
  },
};
export async function drainNewsletterQueue(
  mode: 'hosted' | 'local',
  limit = 1
) {
  if (mode === 'local' && (!envClient.DEV || localDraining)) return;
  if (mode === 'local') localDraining = true;
  try {
    const { repository, worker } = getNewsletterRuntime();
    const workspaces = await repository.enabledWorkspaces();
    if (workspaces.isError()) throw workspaces.getError();
    for (const workspaceId of workspaces.get()) {
      const r = await worker.reconcile(workspaceId);
      if (r.isError())
        getKernel().logger.warn({
          event: 'newsletter.reconcile.failed',
          details: { workspaceId, code: r.getError().code },
        });
    }
    for (let i = 0; i < limit; i++) {
      const result = await worker.runNext(mode);
      if (result.isError()) throw result.getError();
      if (result.get().type === 'queue_empty') break;
    }
  } catch (error) {
    getKernel().logger.warn({
      event: 'newsletter.worker.failed',
      details: {
        message:
          error instanceof Error ? error.message : 'Unknown worker failure',
      },
    });
  } finally {
    if (mode === 'local') localDraining = false;
  }
}
