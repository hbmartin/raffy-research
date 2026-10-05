import { Result } from '@swan-io/boxed';
import { parseArgs } from 'node:util';
import { match, P } from 'ts-pattern';
import { z } from 'zod';

import type {
  createLinkedinMonitoring,
  LinkedinMonitoringOutcome,
} from '@/modules/intelligence';
import { validateLinkedinSelection } from '@/modules/intelligence';
import type { AppError } from '@/modules/kernel/domain/errors/app-error';

const commandSchema = z.enum(['context', 'plan', 'add', 'sync', 'verify']);
type Command = z.infer<typeof commandSchema>;
export const LINKEDIN_MONITORING_USAGE =
  'pnpm linkedin:monitoring <context|plan|add|sync|verify> --workspace <id> [--input <file>]';

export function parseLinkedinMonitoringArgs(args: string[]) {
  let parsed;
  try {
    parsed = parseArgs({
      args: args[0] === '--' ? args.slice(1) : args,
      allowPositionals: true,
      strict: true,
      options: {
        workspace: { type: 'string' },
        input: { type: 'string' },
        help: { type: 'boolean' },
      },
    });
  } catch {
    return {
      type: 'invalid_arguments',
      message: LINKEDIN_MONITORING_USAGE,
    } as const;
  }
  if (parsed.values.help) return { type: 'help' } as const;
  const command = commandSchema.safeParse(parsed.positionals[0]);
  if (!command.success || parsed.positionals.length !== 1)
    return {
      type: 'invalid_arguments',
      message: LINKEDIN_MONITORING_USAGE,
    } as const;
  const workspaceId = parsed.values.workspace;
  if (!workspaceId || !/^[a-zA-Z0-9_-]+$/.test(workspaceId))
    return {
      type: 'invalid_arguments',
      message: '--workspace requires a workspace ID.',
    } as const;
  if (['plan', 'add'].includes(command.data) !== !!parsed.values.input)
    return {
      type: 'invalid_arguments',
      message:
        '--input is required for plan/add and is not accepted for context/sync/verify.',
    } as const;
  return {
    type: 'arguments_valid',
    command: command.data,
    workspaceId,
    inputPath: parsed.values.input,
  } as const;
}

export function linkedinMonitoringExitCode(outcome: LinkedinMonitoringOutcome) {
  return match(outcome)
    .with(
      { type: 'monitoring_context' },
      { type: 'addition_planned' },
      { type: 'synchronized' },
      { type: 'nothing_to_sync' },
      () => 0
    )
    .with({ type: 'targets_verified' }, (value) => (value.pending ? 2 : 0))
    .with(
      { type: 'workspace_not_found' },
      { type: 'invalid_selection' },
      { type: 'workspace_mismatch' },
      { type: 'duplicate_selection' },
      { type: 'provider_configuration_invalid' },
      { type: 'pending_sync' },
      { type: 'ambiguous_accounts' },
      { type: 'invalid_accounts' },
      { type: 'target_drift' },
      { type: 'sync_staged' },
      () => 2
    )
    .exhaustive();
}

export type LinkedinMonitoringCliIO = {
  readInput(path: string): Promise<unknown>;
  createAudit(): Promise<{
    path: string;
    write(value: unknown): Promise<void>;
  }>;
};

/** Exported runner supports fixture verification without loading operator secrets. */
export async function runLinkedinMonitoringCli(
  options: { command: Command; workspaceId: string; inputPath?: string },
  service: ReturnType<typeof createLinkedinMonitoring>,
  io: LinkedinMonitoringCliIO
) {
  const { command, workspaceId } = options;
  const input = options.inputPath
    ? await io.readInput(options.inputPath)
    : undefined;
  const audit =
    command === 'add' || command === 'sync'
      ? await io.createAudit()
      : undefined;
  const result = await match(command)
    .with('context', () => service.context(workspaceId))
    .with('plan', () => service.plan(workspaceId, input))
    .with('add', () => service.add(workspaceId, input))
    .with('sync', () => service.sync(workspaceId))
    .with('verify', () => service.verify(workspaceId))
    .exhaustive();
  const recovery = `pnpm linkedin:monitoring sync --workspace ${workspaceId}`;
  const mapped = match(result)
    .with(Result.P.Ok(P.select()), (value) => ({
      exitCode: linkedinMonitoringExitCode(value),
      data: { outcome: value },
    }))
    .with(Result.P.Error(P.select()), (error: AppError) => ({
      exitCode: 1,
      data: { error: { code: error.code, message: error.message } },
    }))
    .exhaustive();
  const selected =
    input === undefined
      ? undefined
      : validateLinkedinSelection(input, workspaceId);
  let pendingSync;
  if (audit && mapped.exitCode !== 0) {
    const current = await service.context(workspaceId);
    if (current.isOk()) {
      const outcome = current.get();
      if (outcome.type === 'monitoring_context') {
        pendingSync = outcome.pending
          ? { status: 'pending', record: outcome.pending }
          : { status: 'none' };
      } else pendingSync = { status: 'unknown' };
    } else {
      pendingSync = { status: 'unknown' };
    }
  }
  const summary = {
    schemaVersion: 1,
    command,
    workspaceId,
    ...mapped.data,
    ...(pendingSync ? { pendingSync } : {}),
    ...(audit ? { auditPath: audit.path, recoveryCommand: recovery } : {}),
  };
  if (audit)
    await audit.write({
      ...summary,
      ...(selected?.type === 'selection_valid'
        ? { selectedProfiles: selected.selection.profiles }
        : {}),
    });
  return { exitCode: mapped.exitCode, summary };
}
