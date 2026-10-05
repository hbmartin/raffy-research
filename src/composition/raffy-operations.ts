import { Result } from '@swan-io/boxed';
import { z } from 'zod';

import {
  createIntelligenceRuntimeConfig,
  getLocalAiConfig,
} from '@/modules/intelligence/backend';
import { toUserId, toWorkspaceId } from '@/modules/kernel';
import type { ApplicationResult } from '@/modules/kernel/application/result';
import {
  type BusinessOutcome,
  completedArtifacts,
  type OperationKind,
  operationSummary,
  type PageInput,
} from '@/modules/operations';
import { enqueueOperation } from '@/modules/operations/backend';

import { type CommandOptions, required } from './raffy-research';
import { checkRaffyAccess, type RaffyRuntime } from './raffy-runtime';
import { synchronizeNewsletterOperation } from './raffy-worker';

export async function startRaffyOperation(
  runtime: RaffyRuntime,
  group: string,
  command: string,
  workspaceId: string,
  options: CommandOptions
): Promise<ApplicationResult<BusinessOutcome>> {
  const access = await checkRaffyAccess(
    runtime,
    group === 'lab' ? 'lab' : 'pipeline'
  );
  if (access.isError()) return Result.Error(access.getError());
  if (access.get().type !== 'authorized') return Result.Ok(access.get());
  const key = required(options, 'key');
  const workspace = await runtime.useCases.getWorkspaceConfig({
    currentUserId: toUserId(runtime.identity.userId),
    workspaceId: toWorkspaceId(workspaceId),
  });
  if (workspace.isError()) return Result.Error(workspace.getError());
  if (workspace.get().type !== 'workspace_config')
    return Result.Ok(workspace.get());
  const local = getLocalAiConfig();
  const kind: OperationKind =
    command === 'workflow'
      ? 'full_workflow'
      : z
          .enum(['ingest', 'discover', 'generate', 'summarize', 'evaluate'])
          .parse(command);
  const period = options.period
    ? new Date(z.iso.date().parse(options.period))
    : new Date();
  // Idempotency fingerprints include explicit inputs, not moving clock defaults.
  const input: Record<string, unknown> = {
    runtime: group === 'lab' ? 'local' : 'hosted',
    provider:
      group === 'lab'
        ? z
            .enum(['codex-cli', 'claude-code', 'ollama'])
            .parse(options.provider ?? local.provider)
        : 'openai',
    model:
      typeof options.model === 'string'
        ? options.model
        : group === 'lab'
          ? local.model
          : createIntelligenceRuntimeConfig().openAiModel,
    period:
      typeof options.period === 'string' ? period.toISOString() : 'current',
    sourceIds:
      typeof options['source-ids'] === 'string'
        ? z.array(z.string().min(1)).parse(options['source-ids'].split(','))
        : [],
    timeoutMs: local.timeoutMs,
    ollamaBaseUrl: local.ollamaBaseUrl,
    ...(local.ollamaNumCtx ? { ollamaNumCtx: local.ollamaNumCtx } : {}),
    ...(kind === 'discover'
      ? {
          query: required(options, 'query'),
          pages: z.coerce
            .number()
            .int()
            .min(1)
            .max(30)
            .parse(options.pages ?? 10),
        }
      : {}),
    ...(kind === 'evaluate' ? { reportId: required(options, 'report') } : {}),
  };
  return enqueueOperation(runtime.db, {
    workspaceId,
    userId: runtime.identity.userId,
    credentialId: runtime.identity.credentialId,
    kind,
    key: `${group}.${command}:${key}`,
    input,
  });
}

export async function operationCommand(
  runtime: RaffyRuntime,
  command: string,
  workspaceId: string,
  options: CommandOptions,
  page: PageInput
): Promise<ApplicationResult<BusinessOutcome>> {
  if (command === 'list')
    return runtime.operations.list(runtime.identity.userId, workspaceId, page);
  const id = required(options, 'id');
  const found = await runtime.operations.get(runtime.identity.userId, id);
  if (found.isError()) return Result.Error(found.getError());
  const value = found.get();
  if (value.type !== 'operation_found') return Result.Ok(value);
  let operation = value.operation;
  if (operation.externalJobId) {
    const synchronized = await synchronizeNewsletterOperation(
      runtime,
      operation
    );
    if (synchronized.isError()) return Result.Error(synchronized.getError());
    operation = synchronized.get().operation;
  }
  if (operation.workspaceId !== workspaceId)
    return Result.Ok({ type: 'forbidden' });
  if (command === 'status')
    return Result.Ok({
      type: 'operation_found',
      operation: operationSummary(operation),
    });
  if (command === 'results')
    return Result.Ok({
      type: 'operation_results',
      operationId: id,
      status: operation.status,
      result: operation.result,
      completedArtifacts: completedArtifacts(operation.checkpoint),
      recovery:
        operation.status === 'running' || operation.status === 'queued'
          ? `pnpm raffy operations status --workspace ${workspaceId} --id ${id}`
          : undefined,
    });
  if (command === 'diagnostics')
    return operationDiagnostics(runtime, operation, options, page);
  if (command === 'cancel') {
    if (operation.externalJobId) {
      const { cancelNewsletterJob } =
        await import('@/modules/newsletter/backend');
      const ids = z.array(z.string()).safeParse(operation.result?.jobIds);
      for (const jobId of ids.success ? ids.data : [operation.externalJobId]) {
        const cancelled = await cancelNewsletterJob(
          runtime.db,
          workspaceId,
          jobId
        );
        if (cancelled.isError()) return Result.Error(cancelled.getError());
      }
    }
    return runtime.operations.cancel(runtime.identity.userId, id);
  }
  if (command === 'retry') {
    if (
      operation.status !== 'failed' &&
      operation.status !== 'reconciliation_required' &&
      operation.status !== 'cancelled'
    )
      return Result.Ok({ type: 'operation_not_retryable', operationId: id });
    const access = await checkRaffyAccess(
      runtime,
      operation.kind === 'newsletter'
        ? 'newsletter'
        : operation.input.runtime === 'hosted'
          ? 'pipeline'
          : 'lab'
    );
    if (access.isError()) return Result.Error(access.getError());
    if (access.get().type !== 'authorized') return Result.Ok(access.get());
    if (
      operation.status === 'reconciliation_required' &&
      !options['acknowledge-uncertainty']
    )
      return Result.Ok({
        type: 'retry_acknowledgment_required',
        operationId: id,
        recovery: 'Inspect diagnostics before using --acknowledge-uncertainty.',
      });
    if (operation.kind === 'newsletter') {
      const native = operation.externalJobId;
      if (!native)
        return Result.Ok({ type: 'operation_not_retryable', operationId: id });
      return enqueueOperation(
        runtime.db,
        {
          workspaceId,
          userId: runtime.identity.userId,
          credentialId: runtime.identity.credentialId,
          kind: 'newsletter',
          key: `retry:${required(options, 'key')}`,
          parentId: id,
          input: { command: 'retry', jobId: native },
        },
        async (db) => {
          const { createRaffyRuntime } = await import('./raffy-runtime');
          return createRaffyRuntime(
            db,
            runtime.credential,
            runtime.identity
          ).newsletter.retry({
            userId: toUserId(runtime.identity.userId),
            workspaceId,
            jobId: native,
          });
        }
      );
    }
    const steps = z
      .record(
        z.string(),
        z
          .object({ status: z.string(), external: z.boolean().optional() })
          .passthrough()
      )
      .parse(operation.checkpoint.steps ?? {});
    if (
      Object.values(steps).some(
        (step) => step.status === 'dispatched' && step.external
      ) &&
      !options['acknowledge-uncertainty']
    )
      return Result.Ok({
        type: 'retry_acknowledgment_required',
        operationId: id,
        recovery: 'Inspect diagnostics before using --acknowledge-uncertainty.',
      });
    return enqueueOperation(runtime.db, {
      workspaceId,
      userId: runtime.identity.userId,
      credentialId: runtime.identity.credentialId,
      kind: operation.kind,
      key: `retry:${required(options, 'key')}`,
      parentId: id,
      input: operation.input,
    });
  }
  return Result.Ok({ type: 'unknown_command' });
}

async function operationDiagnostics(
  runtime: RaffyRuntime,
  operation: import('@/modules/operations').Operation,
  options: CommandOptions,
  page: PageInput
): Promise<ApplicationResult<BusinessOutcome>> {
  const events = await runtime.operations.events(
    runtime.identity.userId,
    operation.id,
    page
  );
  if (events.isError()) return Result.Error(events.getError());
  if (operation.externalJobId)
    return newsletterDiagnostics(
      runtime,
      operation,
      options,
      page,
      events.get()
    );
  const steps = z
    .record(z.string(), z.object({ status: z.string() }).passthrough())
    .parse(operation.checkpoint.steps ?? {});
  const checkpoint =
    typeof options.stage === 'string'
      ? { stage: options.stage, checkpoint: steps[options.stage] ?? null }
      : {
          stages: Object.entries(steps).map(([name, step]) => ({
            name,
            status: step.status,
          })),
        };
  return Result.Ok({
    ...events.get(),
    ...checkpoint,
    type: 'operation_diagnostics',
    operationId: operation.id,
    status: operation.status,
    stage: operation.stage,
    failure: operation.failure,
  });
}

async function newsletterDiagnostics(
  runtime: RaffyRuntime,
  operation: import('@/modules/operations').Operation,
  options: CommandOptions,
  page: PageInput,
  events: BusinessOutcome
): Promise<ApplicationResult<BusinessOutcome>> {
  const parsed = z.array(z.string()).safeParse(operation.result?.jobIds);
  const ids = parsed.success ? parsed.data : [operation.externalJobId!];
  const selected =
    typeof options.job === 'string'
      ? ids.filter((id) => id === options.job)
      : ids.slice(0, page.limit);
  if (!selected.length) return Result.Ok({ type: 'not_found' });
  const jobs = [];
  for (const id of selected) {
    const found = await runtime.newsletterRepository.getJob(
      operation.workspaceId,
      id
    );
    if (found.isError()) return Result.Error(found.getError());
    const outcome = found.get();
    if (outcome.type !== 'job_found') continue;
    const job = outcome.job;
    const checkpoint = job.checkpoint as Record<string, unknown>;
    jobs.push({
      jobId: id,
      status: job.status,
      stage: job.stage,
      failure: job.failure,
      terminalFailure: job.checkpoint.terminalFailure
        ? {
            code: job.checkpoint.terminalFailure.code,
            message: job.checkpoint.terminalFailure.message,
          }
        : undefined,
      ...(typeof options.stage === 'string'
        ? {
            checkpoint:
              job.checkpoint.repairUnits?.[options.stage] ??
              checkpoint[options.stage] ??
              null,
          }
        : {
            units: Object.entries(job.checkpoint.repairUnits ?? {}).map(
              ([name, unit]) => ({
                name,
                requestInFlight: unit.requestInFlight,
                repairsUsed: unit.repairsUsed,
                responseSaved: Boolean(unit.response),
              })
            ),
            researchDispatch: job.checkpoint.researchDispatch,
          }),
    });
  }
  return Result.Ok({
    ...events,
    type: 'operation_diagnostics',
    operationId: operation.id,
    status: operation.status,
    jobs,
    additionalJobs: Math.max(0, ids.length - selected.length),
    historyCommand: `pnpm raffy newsletter history --workspace ${operation.workspaceId}`,
    recovery:
      'Use --job JOB_ID and --stage UNIT_OR_CHECKPOINT_KEY for selected native diagnostics; newsletter history retains native events.',
  });
}
