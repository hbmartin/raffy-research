import { Result } from '@swan-io/boxed';

import { createAgentResearch } from '@/modules/intelligence/backend';
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
  createContextDiscovery,
  createHostedNewsletterModel,
  createNewsletterRepository,
} from '@/modules/newsletter/backend';
import { envClient } from '@/platform/env/client';

import { getKernel } from './kernel';
import { newsletterExecutionConfig } from './newsletter-config';
import { createCachedFactory } from './shared/singleton';

function buildNewsletterRuntime() {
  const kernel = getKernel();
  const execution = newsletterExecutionConfig();
  const repository = createNewsletterRepository(kernel.db, (tx, decision) =>
    createAgentResearch(tx).recordJudgment(decision)
  );
  const archive = createPublicResearchArchive(kernel.db);
  const hosted = createHostedNewsletterModel({
    apiKey: () => createIntelligenceRuntimeConfig().openAiApiKey,
    measure: (details) =>
      kernel.logger.info({ event: 'newsletter.provider.completed', details }),
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
      let timeout: AbortSignal | undefined;
      try {
        const config = getLocalAiConfig();
        timeout = AbortSignal.timeout(
          input.timeoutMs ?? execution.localTimeoutMs
        );
        if (
          input.runtime.provider === 'ollama' &&
          (!config.ollamaNumCtx ||
            (input.contextBudget ?? Infinity) > config.ollamaNumCtx)
        )
          return Result.Error(
            new AppError({
              code: 'NEWSLETTER_LOCAL_ALLOCATION',
              category: 'system',
              status: 422,
              message:
                'Set OLLAMA_NUM_CTX at or above the pinned job context, then Retry with current settings.',
              details: {
                pinnedContext: input.contextBudget,
                operatorCeiling: config.ollamaNumCtx,
              },
            })
          );
        const output = await generateLocalText({
          provider: input.runtime.provider,
          model: input.runtime.model,
          prompt: input.prompt,
          action: 'newsletter',
          label: input.stage,
          runId: input.jobId,
          rawOutputDir: config.rawOutputDir,
          ollamaBaseUrl: config.ollamaBaseUrl,
          ollamaNumCtx: input.contextBudget ?? config.ollamaNumCtx,
          abortSignal: AbortSignal.any([
            timeout,
            ...(input.signal ? [input.signal] : []),
          ]),
        });
        return Result.Ok(output.text);
      } catch (cause) {
        if (input.signal?.aborted && input.signal.reason instanceof AppError)
          return Result.Error(input.signal.reason);
        return Result.Error(
          new AppError({
            code: timeout?.aborted
              ? 'NEWSLETTER_PROVIDER_TIMEOUT'
              : 'LOCAL_NEWSLETTER_FAILED',
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
    localOperatorId: execution.operatorId,
    requestTimeoutMs: (runtime) =>
      runtime.mode === 'hosted'
        ? execution.hostedTimeoutMs
        : execution.localTimeoutMs,
    persistenceReserveMs: execution.persistenceReserveMs,
    measure: (details) =>
      kernel.logger.info({ event: 'newsletter.generation', details }),
  });
  const useCases = createNewsletterUseCases({
    repository,
    archive,
    operatorContextCeiling: () => getLocalAiConfig().ollamaNumCtx,
    localOperatorId: envClient.DEV ? execution.operatorId : undefined,
    discoverContextBudget: createContextDiscovery({
      ollamaBaseUrl: () => getLocalAiConfig().ollamaBaseUrl,
    }),
    permissionChecker: kernel.permissionChecker,
    clock: kernel.clock,
    idGenerator: kernel.idGenerator,
  });
  return { repository, archive, worker, useCases };
}

const runtimeFactory = createCachedFactory(buildNewsletterRuntime);
export const getNewsletterRuntime = () => runtimeFactory.get();

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
  limit = Infinity
) {
  const config = newsletterExecutionConfig();
  if (config.paused) return { status: 'paused' as const, stages: 0 };
  if (
    mode === 'local' &&
    (!envClient.DEV || localDraining || !config.operatorId)
  )
    return { status: 'idle' as const, stages: 0 };
  if (mode === 'local') {
    const permitted = await getKernel().permissionChecker.hasPermission(
      config.operatorId as import('@/modules/kernel/domain/ids').UserId,
      { report: ['read'] }
    );
    if (permitted.isError()) throw permitted.getError();
    if (permitted.get().type !== 'permission_granted')
      throw new AppError({
        code: 'LOCAL_NEWSLETTER_OPERATOR_INVALID',
        category: 'system',
        status: 403,
        message: 'Configure a local operator with report access',
      });
    localDraining = true;
  }
  const deadline = new Date(
    Date.now() +
      (mode === 'hosted'
        ? config.durationSeconds * 800
        : config.localWorkSeconds * 1000)
  );
  let stages = 0;
  try {
    const { repository, worker } = getNewsletterRuntime();
    const publications = await repository.pendingPublications();
    if (publications.isError()) throw publications.getError();
    for (const workspaceId of new Set(
      publications.get().map((p) => p.workspaceId)
    )) {
      const reconciled = await worker.reconcile(workspaceId);
      if (reconciled.isError())
        getKernel().logger.warn({
          event: 'newsletter.reconcile.failed',
          details: { workspaceId, code: reconciled.getError().code },
        });
      else if (reconciled.get().type === 'configuration_required')
        getKernel().logger.warn({
          event: 'newsletter.reconcile.configuration',
          details: { workspaceId, issue: reconciled.get() },
        });
    }
    while (stages < limit && Date.now() < deadline.getTime()) {
      const result = await worker.runNext(mode, { deadline });
      if (result.isError()) throw result.getError();
      if (result.get().type === 'queue_empty') break;
      stages++;
      const outcome = result.get();
      if (
        outcome.type === 'job_finished' &&
        outcome.yieldReason === 'invocation_budget'
      )
        break;
    }
    return { status: 'processed' as const, stages };
  } finally {
    if (mode === 'local') localDraining = false;
  }
}
