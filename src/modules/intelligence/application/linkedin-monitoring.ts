import { Result } from '@swan-io/boxed';
import { unique } from 'remeda';

import type { Clock } from '@/modules/kernel/application/ports/clock';
import { AppError } from '@/modules/kernel/domain/errors/app-error';

import type {
  LinkedinProviderTask,
  LinkedinTaskReference,
  LinkedinWatchlistRepository,
  LinkedinWatchlistSnapshot,
} from './ports/linkedin-monitoring';
import type { LinkedinPendingSync } from '../domain/linkedin-monitoring';
import {
  linkedinPendingSchema,
  normalizeLinkedinUrl,
  sameTargets,
  sortedTargets,
  validateLinkedinSelection,
} from '../domain/linkedin-monitoring';

export type LinkedinMonitoringOutcome =
  | { type: 'workspace_not_found' }
  | Exclude<
      ReturnType<typeof validateLinkedinSelection>,
      { type: 'selection_valid' }
    >
  | { type: 'provider_configuration_invalid'; reason: string }
  | { type: 'pending_sync'; pending: LinkedinPendingSync }
  | { type: 'ambiguous_accounts'; urls: string[] }
  | { type: 'invalid_accounts'; accountIds: string[] }
  | { type: 'target_drift'; databaseTargets: string[]; remoteTargets: string[] }
  | {
      type: 'monitoring_context';
      workspace: LinkedinWatchlistSnapshot['workspace'];
      keywords: string[];
      competitors: LinkedinWatchlistSnapshot['competitors'];
      watchlist: Omit<
        LinkedinWatchlistSnapshot['accounts'][number],
        'metadata'
      >[];
      provider: {
        enabled: boolean;
        taskId?: string;
        scheduleId?: string;
        credentialsRef: string | null;
      };
      pending?: LinkedinPendingSync;
    }
  | {
      type: 'addition_planned';
      profiles: { url: string; action: 'add' | 'reactivate' | 'reuse' }[];
      intendedTargets: string[];
    }
  | { type: 'sync_staged'; pending: LinkedinPendingSync }
  | {
      type: 'targets_verified';
      targets: string[];
      pending?: LinkedinPendingSync;
    }
  | { type: 'synchronized'; targets: string[] }
  | { type: 'nothing_to_sync' };

type OperationResult = Result<LinkedinMonitoringOutcome, AppError>;
type SyncTransactionOutcome =
  | LinkedinMonitoringOutcome
  | { type: 'sync_failure_recorded'; error: AppError };

function referenceFor(snapshot: LinkedinWatchlistSnapshot) {
  const provider = snapshot.provider;
  // Support the historic actorTaskId spelling as well as taskId.
  const taskId = provider?.config.taskId ?? provider?.config.actorTaskId;
  const scheduleId = provider?.config.scheduleId;
  if (
    !provider?.enabled ||
    typeof taskId !== 'string' ||
    !/^[a-zA-Z0-9_-]+$/.test(taskId) ||
    (scheduleId !== undefined &&
      (typeof scheduleId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(scheduleId)))
  ) {
    return {
      type: 'provider_configuration_invalid',
      reason:
        'An enabled Apify provider with a valid taskId and optional scheduleId is required.',
    } as const;
  }
  return {
    type: 'reference_found',
    reference: {
      taskId,
      ...(typeof scheduleId === 'string' ? { scheduleId } : {}),
      credentialsRef: provider.credentialsRef,
    } satisfies LinkedinTaskReference,
  } as const;
}

function pendingFor(snapshot: LinkedinWatchlistSnapshot) {
  const value = snapshot.provider?.config.linkedinMonitoringPending;
  if (value === undefined || value === null)
    return { type: 'no_pending_sync' } as const;
  const parsed = linkedinPendingSchema.safeParse(value);
  if (!parsed.success)
    return {
      type: 'provider_configuration_invalid',
      reason:
        'The pending synchronization record is invalid; review provider configuration.',
    } as const;
  return { type: 'pending_sync', pending: parsed.data } as const;
}

function accountsFor(snapshot: LinkedinWatchlistSnapshot) {
  const accounts = snapshot.accounts.filter(
    (account) =>
      account.platform?.toLowerCase() === 'linkedin' ||
      (account.profileUrl && normalizeLinkedinUrl(account.profileUrl))
  );
  const invalid = accounts.filter(
    (account) =>
      account.active && !normalizeLinkedinUrl(account.profileUrl ?? '')
  );
  if (invalid.length)
    return {
      type: 'invalid_accounts',
      accountIds: invalid.map((account) => account.id),
    } as const;
  const urls = accounts
    .map((account) => normalizeLinkedinUrl(account.profileUrl ?? ''))
    .filter((url): url is string => !!url);
  const duplicates = unique(
    urls.filter((url, index) => urls.indexOf(url) !== index)
  );
  if (duplicates.length)
    return { type: 'ambiguous_accounts', urls: duplicates } as const;
  return {
    type: 'accounts_valid',
    accounts,
    targets: sortedTargets(
      accounts
        .filter((account) => account.active)
        .map((account) => normalizeLinkedinUrl(account.profileUrl!)!)
    ),
  } as const;
}

export function createLinkedinMonitoring(deps: {
  repository: LinkedinWatchlistRepository;
  providerTask: LinkedinProviderTask;
  clock: Clock;
}) {
  const now = () => deps.clock.now().toISOString();

  async function context(workspaceId: string): Promise<OperationResult> {
    const result = await deps.repository.read(workspaceId);
    if (result.isError()) return Result.Error(result.getError());
    const found = result.get();
    if (found.type === 'workspace_not_found') return Result.Ok(found);
    const snapshot = found.snapshot;
    const pending = pendingFor(snapshot);
    if (pending.type === 'provider_configuration_invalid')
      return Result.Ok(pending);
    const reference = referenceFor(snapshot);
    return Result.Ok({
      type: 'monitoring_context',
      workspace: snapshot.workspace,
      keywords: snapshot.keywords,
      competitors: snapshot.competitors,
      watchlist: snapshot.accounts.map(
        ({ metadata: _metadata, ...account }) => account
      ),
      provider: {
        enabled: snapshot.provider?.enabled ?? false,
        credentialsRef: snapshot.provider?.credentialsRef ?? null,
        ...(reference.type === 'reference_found'
          ? {
              taskId: reference.reference.taskId,
              scheduleId: reference.reference.scheduleId,
            }
          : {}),
      },
      ...(pending.type === 'pending_sync' ? { pending: pending.pending } : {}),
    });
  }

  async function prepare(
    workspaceId: string,
    input: unknown,
    write: boolean
  ): Promise<OperationResult> {
    const selection = validateLinkedinSelection(input, workspaceId);
    if (selection.type !== 'selection_valid') return Result.Ok(selection);
    return deps.repository.withWorkspaceLock<LinkedinMonitoringOutcome>(
      workspaceId,
      async (snapshot, writer): Promise<OperationResult> => {
        const reference = referenceFor(snapshot);
        if (reference.type !== 'reference_found') return Result.Ok(reference);
        const pending = pendingFor(snapshot);
        if (pending.type !== 'no_pending_sync') return Result.Ok(pending);
        const accounts = accountsFor(snapshot);
        if (accounts.type !== 'accounts_valid') return Result.Ok(accounts);
        const inspected = await deps.providerTask.inspect(reference.reference);
        if (inspected.isError()) return Result.Error(inspected.getError());
        const remote = inspected.get();
        if (remote.type !== 'task_inspected') return Result.Ok(remote);
        if (!sameTargets(accounts.targets, remote.state.targets))
          return Result.Ok({
            type: 'target_drift',
            databaseTargets: accounts.targets,
            remoteTargets: remote.state.targets,
          });
        const profiles = selection.selection.profiles.map((profile) => {
          const existing = accounts.accounts.find(
            (account) =>
              normalizeLinkedinUrl(account.profileUrl ?? '') === profile.url
          );
          return {
            url: profile.url,
            action: !existing
              ? 'add'
              : existing.active
                ? 'reuse'
                : 'reactivate',
          } as const;
        });
        const intended = sortedTargets([
          ...accounts.targets,
          ...profiles.map((profile) => profile.url),
        ]);
        if (!write)
          return Result.Ok({
            type: 'addition_planned',
            profiles,
            intendedTargets: intended,
          });
        const selectedAt = now();
        const saved = await writer.selectProfiles(
          selection.selection.profiles,
          selectedAt
        );
        if (saved.isError()) return Result.Error(saved.getError());
        const record: LinkedinPendingSync = {
          version: 1,
          taskId: reference.reference.taskId,
          createdAt: selectedAt,
          baseline: sortedTargets(remote.state.targets),
          intended,
        };
        const staged = await writer.saveProviderConfig({
          ...snapshot.provider!.config,
          linkedinMonitoringPending: record,
        });
        if (staged.isError()) return Result.Error(staged.getError());
        return Result.Ok({ type: 'sync_staged', pending: record });
      }
    );
  }

  async function sync(workspaceId: string): Promise<OperationResult> {
    const result =
      await deps.repository.withWorkspaceLock<SyncTransactionOutcome>(
        workspaceId,
        async (
          snapshot,
          writer
        ): Promise<Result<SyncTransactionOutcome, AppError>> => {
          const pending = pendingFor(snapshot);
          if (pending.type === 'no_pending_sync')
            return Result.Ok({ type: 'nothing_to_sync' });
          if (pending.type !== 'pending_sync') return Result.Ok(pending);
          const reference = referenceFor(snapshot);
          if (reference.type !== 'reference_found') return Result.Ok(reference);
          if (reference.reference.taskId !== pending.pending.taskId)
            return Result.Ok({
              type: 'provider_configuration_invalid',
              reason:
                'The configured task changed after staging; review pending synchronization.',
            });
          const accounts = accountsFor(snapshot);
          if (accounts.type !== 'accounts_valid') return Result.Ok(accounts);
          if (!sameTargets(accounts.targets, pending.pending.intended))
            return Result.Ok({
              type: 'target_drift',
              databaseTargets: accounts.targets,
              remoteTargets: pending.pending.intended,
            });
          // Commit sanitized failure diagnostics before mapping back to Result.Error.
          const recordFailure = async (
            error: AppError
          ): Promise<Result<SyncTransactionOutcome, AppError>> => {
            const saved = await writer.saveProviderConfig({
              ...snapshot.provider!.config,
              linkedinMonitoringPending: {
                ...pending.pending,
                failureCode: error.code,
              },
            });
            return saved.isError()
              ? Result.Error(saved.getError())
              : Result.Ok({ type: 'sync_failure_recorded', error });
          };
          const inspected = await deps.providerTask.inspect(
            reference.reference
          );
          if (inspected.isError()) return recordFailure(inspected.getError());
          const remote = inspected.get();
          if (remote.type !== 'task_inspected') return Result.Ok(remote);
          if (!sameTargets(remote.state.targets, pending.pending.intended)) {
            if (!sameTargets(remote.state.targets, pending.pending.baseline))
              return Result.Ok({
                type: 'target_drift',
                databaseTargets: accounts.targets,
                remoteTargets: remote.state.targets,
              });
            const updated = await deps.providerTask.updateTargets(
              reference.reference,
              pending.pending.intended
            );
            if (updated.isError()) return recordFailure(updated.getError());
            const verified = await deps.providerTask.inspect(
              reference.reference
            );
            if (verified.isError()) return recordFailure(verified.getError());
            const state = verified.get();
            if (state.type !== 'task_inspected') return Result.Ok(state);
            if (!sameTargets(state.state.targets, pending.pending.intended))
              return recordFailure(
                new AppError({
                  code: 'LINKEDIN_SYNC_VERIFY_FAILED',
                  category: 'system',
                  status: 502,
                  message: 'Apify did not retain the intended targets.',
                })
              );
          }
          const completed = await writer.saveProviderConfig({
            ...snapshot.provider!.config,
            targetCount: accounts.targets.length,
            linkedinMonitoringPending: null,
            linkedinMonitoringLastSyncedAt: now(),
          });
          if (completed.isError()) return Result.Error(completed.getError());
          return Result.Ok({ type: 'synchronized', targets: accounts.targets });
        }
      );
    if (result.isError()) return Result.Error(result.getError());
    const outcome = result.get();
    return outcome.type === 'sync_failure_recorded'
      ? Result.Error(outcome.error)
      : Result.Ok(outcome);
  }

  async function verify(workspaceId: string): Promise<OperationResult> {
    return deps.repository.withWorkspaceLock<LinkedinMonitoringOutcome>(
      workspaceId,
      async (snapshot): Promise<OperationResult> => {
        const reference = referenceFor(snapshot);
        if (reference.type !== 'reference_found') return Result.Ok(reference);
        const pending = pendingFor(snapshot);
        if (pending.type === 'provider_configuration_invalid')
          return Result.Ok(pending);
        const accounts = accountsFor(snapshot);
        if (accounts.type !== 'accounts_valid') return Result.Ok(accounts);
        const inspected = await deps.providerTask.inspect(reference.reference);
        if (inspected.isError()) return Result.Error(inspected.getError());
        const remote = inspected.get();
        if (remote.type !== 'task_inspected') return Result.Ok(remote);
        return Result.Ok(
          sameTargets(accounts.targets, remote.state.targets)
            ? {
                type: 'targets_verified',
                targets: accounts.targets,
                ...(pending.type === 'pending_sync'
                  ? { pending: pending.pending }
                  : {}),
              }
            : {
                type: 'target_drift',
                databaseTargets: accounts.targets,
                remoteTargets: remote.state.targets,
              }
        );
      }
    );
  }

  return {
    context,
    plan: (workspaceId: string, input: unknown) =>
      prepare(workspaceId, input, false),
    sync,
    verify,
    async add(workspaceId: string, input: unknown): Promise<OperationResult> {
      const staged = await prepare(workspaceId, input, true);
      if (staged.isError() || staged.get().type !== 'sync_staged')
        return staged;
      return sync(workspaceId);
    },
  };
}
