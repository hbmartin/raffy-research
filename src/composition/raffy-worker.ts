import { Result } from '@swan-io/boxed';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

import {
  createIntelligenceRuntimeConfig,
  generateLocalText,
  getLocalAiConfig,
} from '@/modules/intelligence/backend';
import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import {
  createNewsletterWorker,
  type NewsletterModel,
} from '@/modules/newsletter';
import {
  cancelNewsletterJob,
  createHostedNewsletterModel,
} from '@/modules/newsletter/backend';
import { executeOperation, type Operation } from '@/modules/operations';
import {
  pendingExternalOperations,
  syncExternalOperation,
} from '@/modules/operations/backend';

import { createRaffyExecutor } from './raffy-executor';
import { checkRaffyAccess, type RaffyRuntime } from './raffy-runtime';

export async function synchronizeNewsletterOperation(
  runtime: RaffyRuntime,
  operation: Operation
): Promise<
  ApplicationResult<{ type: 'operation_found'; operation: Operation }>
> {
  const ids = z.array(z.string()).safeParse(operation.result?.jobIds);
  const jobIds =
    ids.success && ids.data.length
      ? ids.data
      : operation.externalJobId
        ? [operation.externalJobId]
        : [];
  const jobs = [];
  for (const id of jobIds) {
    const found = await runtime.newsletterRepository.getJob(
      operation.workspaceId,
      id
    );
    if (found.isError()) return Result.Error(found.getError());
    const value = found.get();
    if (value.type === 'job_found') jobs.push(value.job);
  }
  const status: Operation['status'] =
    jobs.length !== jobIds.length
      ? 'failed'
      : operation.cancelRequested
        ? 'cancelled'
        : jobs.some((job) => job.status === 'running')
          ? 'running'
          : jobs.some((job) => job.status === 'queued')
            ? 'queued'
            : jobs.some(
                  (job) =>
                    job.checkpoint.terminalFailure?.code ===
                    'NEWSLETTER_RECONCILIATION_REQUIRED'
                )
              ? 'reconciliation_required'
              : jobs.some((job) => job.status === 'failed')
                ? 'failed'
                : 'succeeded';
  const result = {
    type: 'newsletter_operation_result',
    jobIds,
    jobs: jobs.map((job) => ({
      jobId: job.id,
      stage: job.stage,
      status: job.status,
      failure: job.failure,
      selectionId: job.selectionId,
    })),
  };
  const synced = await syncExternalOperation(
    runtime.db,
    runtime.identity.userId,
    operation.id,
    status,
    result
  );
  if (synced.isError()) return Result.Error(synced.getError());
  return Result.Ok({
    type: 'operation_found' as const,
    operation: { ...operation, status, result },
  });
}

function newsletterWorker(runtime: RaffyRuntime, signal: AbortSignal) {
  const hosted = createHostedNewsletterModel({
    apiKey: () => createIntelligenceRuntimeConfig().openAiApiKey,
  });
  const model: NewsletterModel = {
    async generate(input) {
      const access = await checkRaffyAccess(runtime, 'newsletter');
      if (access.isError()) return Result.Error(access.getError());
      if (access.get().type !== 'authorized')
        return Result.Error(
          new AppError({
            code: 'MACHINE_CREDENTIAL_REVOKED',
            category: 'unauthorized',
            status: 401,
          })
        );
      const combined = AbortSignal.any([
        signal,
        ...(input.signal ? [input.signal] : []),
      ]);
      if (input.runtime.mode === 'hosted')
        return hosted.generate({ ...input, signal: combined });
      if (
        input.runtime.localOperatorId !== runtime.identity.userId ||
        input.runtime.provider === 'openai'
      )
        return Result.Error(
          new AppError({
            code: 'LOCAL_OPERATOR_MISMATCH',
            category: 'forbidden',
            status: 403,
          })
        );
      try {
        const config = getLocalAiConfig();
        if (
          input.runtime.provider === 'ollama' &&
          (!config.ollamaNumCtx ||
            (input.contextBudget ?? Infinity) > config.ollamaNumCtx)
        )
          return Result.Error(
            new AppError({
              code: 'NEWSLETTER_LOCAL_ALLOCATION',
              category: 'bad_request',
              status: 422,
            })
          );
        const generated = await generateLocalText({
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
            combined,
            AbortSignal.timeout(config.timeoutMs),
          ]),
        });
        return Result.Ok(generated.text);
      } catch (cause) {
        return Result.Error(
          cause instanceof AppError
            ? cause
            : new AppError({
                code: 'NEWSLETTER_MODEL_FAILED',
                category: 'system',
                status: 502,
                cause,
              })
        );
      }
    },
  };
  return createNewsletterWorker({
    repository: runtime.newsletterRepository,
    archive: {
      ...runtime.archive,
      research: (input) =>
        runtime.archive.research({
          ...input,
          signal: AbortSignal.any([
            signal,
            ...(input.signal ? [input.signal] : []),
          ]),
        }),
    },
    model,
    clock: runtime.clock,
    idGenerator: runtime.idGenerator,
    localOperatorId: runtime.identity.userId,
    requireDispatchReconciliation: true,
  });
}

export async function reconcileRaffyPublications(
  runtime: RaffyRuntime,
  signal: AbortSignal,
  workspaceId: string
) {
  return newsletterWorker(runtime, signal).reconcile(workspaceId);
}

async function runExternal(runtime: RaffyRuntime, hostSignal: AbortSignal) {
  const access = await checkRaffyAccess(runtime, 'newsletter');
  if (access.isError() || access.get().type !== 'authorized') return;
  const pending = await pendingExternalOperations(
    runtime.db,
    runtime.identity.credentialId
  );
  if (pending.isError()) return;
  for (const operation of pending.get().operations) {
    if (hostSignal.aborted) return;
    const ids = z.array(z.string()).safeParse(operation.result?.jobIds);
    const jobIds =
      ids.success && ids.data.length
        ? ids.data
        : operation.externalJobId
          ? [operation.externalJobId]
          : [];
    for (const jobId of jobIds) {
      const found = await runtime.newsletterRepository.getJob(
        operation.workspaceId,
        jobId
      );
      if (found.isError()) continue;
      const value = found.get();
      if (
        value.type !== 'job_found' ||
        value.job.status === 'failed' ||
        value.job.status === 'succeeded'
      )
        continue;
      if (operation.cancelRequested) {
        await cancelNewsletterJob(runtime.db, operation.workspaceId, jobId);
        continue;
      }
      const controller = new AbortController();
      const monitor = setInterval(() => {
        void (async () => {
          const [current, identity] = await Promise.all([
            runtime.operations.get(operation.userId, operation.id),
            runtime.credentials.authenticate(
              runtime.credential.id,
              runtime.credential.secret
            ),
          ]);
          const state = current.isOk() ? current.get() : undefined;
          if (
            state?.type !== 'operation_found' ||
            state.operation.cancelRequested ||
            identity.isError() ||
            identity.get().type !== 'machine_authenticated'
          )
            controller.abort();
        })().catch(() => controller.abort());
      }, 1000);
      const worker = newsletterWorker(
        runtime,
        AbortSignal.any([hostSignal, controller.signal])
      );
      try {
        await worker.runNext(value.job.runtime.mode, {
          jobId,
          deadline: new Date(Date.now() + 15 * 60_000),
        });
      } finally {
        clearInterval(monitor);
      }
    }
    await synchronizeNewsletterOperation(runtime, operation);
  }
}

export async function runRaffyWorker(
  runtime: RaffyRuntime,
  signal: AbortSignal
) {
  const executor = createRaffyExecutor(
    runtime,
    (workspaceId, executionSignal) =>
      reconcileRaffyPublications(runtime, executionSignal, workspaceId)
  );
  while (!signal.aborted) {
    const authenticated = await runtime.credentials.authenticate(
      runtime.credential.id,
      runtime.credential.secret
    );
    if (
      authenticated.isError() ||
      authenticated.get().type !== 'machine_authenticated'
    )
      return;
    const claimed = await runtime.operations.claim(
      runtime.identity.credentialId
    );
    if (claimed.isError()) {
      runtime.logger.error({ event: 'raffy.worker.claim_failed' });
      await delay(1000);
      continue;
    }
    const value = claimed.get();
    if (value.type === 'queue_empty') {
      await runExternal(runtime, signal);
      await delay(1000);
      continue;
    }
    const operation = value.operation,
      controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    let renewedAt = 0;
    const timer = setInterval(() => {
      void (async () => {
        const [current, auth] = await Promise.all([
          runtime.operations.get(operation.userId, operation.id),
          runtime.credentials.authenticate(
            runtime.credential.id,
            runtime.credential.secret
          ),
        ]);
        const state = current.isOk() ? current.get() : undefined;
        if (
          state?.type !== 'operation_found' ||
          state.operation.cancelRequested ||
          state.operation.leaseToken !== operation.leaseToken ||
          auth.isError() ||
          auth.get().type !== 'machine_authenticated'
        ) {
          controller.abort();
          return;
        }
        if (Date.now() - renewedAt >= 30_000) {
          const renewed = await runtime.operations.heartbeat(operation);
          renewedAt = Date.now();
          if (renewed.isError() || renewed.get().type === 'lease_lost')
            controller.abort();
        }
      })().catch(() => controller.abort());
    }, 1000);
    try {
      await runtime.operations.event(operation, {
        type: 'execution_started',
        stage: operation.stage,
      });
      await executeOperation({
        operation,
        repository: runtime.operations,
        executor,
        signal: combined,
        authorize: () =>
          checkRaffyAccess(
            runtime,
            operation.input.runtime === 'hosted' ? 'pipeline' : 'lab'
          ),
      });
      if (combined.aborted) {
        const latest = await runtime.operations.get(
          operation.userId,
          operation.id
        );
        const found = latest.isOk() ? latest.get() : undefined;
        const cancellation =
          found?.type === 'operation_found' && found.operation.cancelRequested;
        await runtime.operations.update(operation, {
          status: cancellation ? 'cancelled' : 'queued',
        });
      }
    } catch (cause) {
      await runtime.operations.update(operation, {
        status: 'failed',
        failure:
          cause instanceof AppError ? cause.code : 'WORKER_EXECUTION_FAILED',
      });
    } finally {
      clearInterval(timer);
    }
  }
}
