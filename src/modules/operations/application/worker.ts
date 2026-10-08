import { Result } from '@swan-io/boxed';
import { z } from 'zod';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';

import type { OperationRepository } from './ports';
import type { BusinessOutcome, Operation } from '../domain/operation';

const zSteps = z.record(
  z.string(),
  z.object({
    status: z.enum(['dispatched', 'completed']),
    external: z.boolean().optional(),
    result: z.record(z.string(), z.unknown()).optional(),
  })
);
export type OperationContext = {
  signal: AbortSignal;
  step(
    name: string,
    external: boolean,
    work: () => Promise<ApplicationResult<BusinessOutcome>>
  ): Promise<ApplicationResult<BusinessOutcome>>;
};
export type OperationExecutor = (
  operation: Operation,
  context: OperationContext
) => Promise<ApplicationResult<BusinessOutcome>>;

export async function executeOperation(input: {
  operation: Operation;
  repository: OperationRepository;
  executor: OperationExecutor;
  signal: AbortSignal;
  authorize?: () => Promise<ApplicationResult<{ type: string }>>;
}): Promise<ApplicationResult<BusinessOutcome>> {
  const { operation, repository } = input;
  const parsed = zSteps.safeParse(operation.checkpoint.steps ?? {});
  if (!parsed.success)
    return Result.Error(
      new AppError({
        code: 'OPERATION_CHECKPOINT_INVALID',
        category: 'system',
        status: 500,
      })
    );
  const steps = parsed.data;
  const uncertain = Object.entries(steps).find(
    ([, step]) => step.status === 'dispatched' && step.external
  );
  if (uncertain) {
    const outcome = {
      type: 'reconciliation_required',
      stage: uncertain[0],
      recovery:
        'Inspect diagnostics, then retry with --acknowledge-uncertainty and a new idempotency key.',
    };
    const saved = await repository.update(operation, {
      status: 'reconciliation_required',
      result: outcome,
    });
    if (saved.isError()) return Result.Error(saved.getError());
    return Result.Ok(outcome);
  }
  const checkpoint = async () =>
    repository.update(operation, {
      stage: operation.stage,
      checkpoint: { ...operation.checkpoint, steps },
    });
  const result = await input.executor(operation, {
    signal: input.signal,
    async step(name, external, work) {
      if (input.signal.aborted)
        return Result.Ok({ type: 'operation_interrupted', stage: name });
      const previous = steps[name];
      if (
        previous?.status === 'completed' &&
        previous.result &&
        typeof previous.result.type === 'string'
      )
        return Result.Ok(previous.result as BusinessOutcome);
      if (previous?.status === 'dispatched' && external)
        return Result.Ok({
          type: 'reconciliation_required',
          stage: name,
          recovery:
            'Inspect diagnostics, then retry with --acknowledge-uncertainty and a new idempotency key.',
        });
      const access = await input.authorize?.();
      if (access?.isError()) return Result.Error(access.getError());
      if (access?.isOk() && access.get().type !== 'authorized')
        return Result.Ok({ type: 'forbidden', stage: name });
      operation.stage = name;
      steps[name] = { status: 'dispatched', external };
      const saved = await checkpoint();
      if (saved.isError()) return Result.Error(saved.getError());
      if (saved.get().type === 'lease_lost')
        return Result.Ok({ type: 'lease_lost' });
      const result = await work();
      if (result.isError()) return Result.Error(result.getError());
      if (
        [
          'operation_interrupted',
          'reconciliation_required',
          'lease_lost',
          'forbidden',
        ].includes(result.get().type)
      )
        return result;
      steps[name] = { status: 'completed', result: result.get() };
      const committed = await checkpoint();
      if (committed.isError()) return Result.Error(committed.getError());
      if (committed.get().type === 'lease_lost')
        return Result.Ok({ type: 'lease_lost' });
      await repository.event(operation, {
        type: 'stage_completed',
        stage: name,
      });
      return result;
    },
  });
  if (input.signal.aborted)
    return Result.Ok({
      type: 'operation_interrupted',
      operationId: operation.id,
    });
  const pendingDispatch = Object.entries(steps).find(
    ([, step]) => step.status === 'dispatched' && step.external
  );
  const outcome = pendingDispatch
    ? {
        type: 'reconciliation_required',
        stage: pendingDispatch[0],
        failure: result.isError() ? result.getError().code : null,
        recovery:
          'Inspect diagnostics before explicitly retrying with --acknowledge-uncertainty.',
      }
    : result.isOk()
      ? result.get()
      : undefined;
  if (outcome?.type === 'lease_lost') return result;
  const status =
    outcome?.type === 'reconciliation_required'
      ? 'reconciliation_required'
      : result.isError()
        ? 'failed'
        : outcome?.type === 'operation_interrupted'
          ? 'queued'
          : [
                'report_failed',
                'evaluation_invalid',
                'workflow_evaluation_failed',
                'forbidden',
                'workspace_not_found',
                'report_not_found',
                'source_record_not_found',
                'workspace_ingestion_failed',
              ].includes(outcome?.type ?? '')
            ? 'failed'
            : 'succeeded';
  await repository.event(operation, { type: 'execution_finished', status });
  const finished = await repository.update(operation, {
    checkpoint: { ...operation.checkpoint, steps },
    status,
    failure: result.isError() ? result.getError().code : null,
    result: outcome ?? null,
  });
  if (finished.isError()) return Result.Error(finished.getError());
  return pendingDispatch && outcome ? Result.Ok(outcome) : result;
}
