import { Result } from '@swan-io/boxed';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { z } from 'zod';

import { newsletterCommand } from '@/composition/raffy-newsletter';
import {
  operationCommand,
  startRaffyOperation,
} from '@/composition/raffy-operations';
import { researchCommand } from '@/composition/raffy-research';
import {
  checkRaffyAccess,
  createRaffyRuntime,
} from '@/composition/raffy-runtime';
import { runRaffyWorker } from '@/composition/raffy-worker';
import { MACHINE_CAPABILITIES, zMachineCapabilities } from '@/modules/auth';
import { createMachineCredentials } from '@/modules/auth/backend';
import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import { createDbClient } from '@/modules/kernel/infrastructure/db/client';
import { type BusinessOutcome, zPage } from '@/modules/operations';
import { readRuntimeEnv } from '@/platform/env/runtime-env';

import { help, parseCommand } from './commands';
import { doctor } from './doctor';
import { serializeResult } from './output';
import { readProfile, removeProfile, writeProfile } from './profile';
import {
  ownWorker,
  startWorker,
  stopWorker,
  workerStatus,
} from './worker-process';

const print = (result: ApplicationResult<BusinessOutcome>) => {
  if (result.isError()) process.exitCode = 1;
  process.stdout.write(`${JSON.stringify(serializeResult(result))}\n`);
};
export async function main(argv: string[]) {
  if (!argv.length || argv.includes('--help')) {
    print(Result.Ok(help()));
    return;
  }
  let db: ReturnType<typeof createDbClient> | undefined;
  try {
    const { group, command, options } = parseCommand(argv);
    const profileName =
      typeof options.profile === 'string' ? options.profile : 'default';
    if (group === 'doctor') {
      print(Result.Ok(await doctor(profileName)));
      return;
    }
    db = createDbClient();
    const auth = createMachineCredentials(db);
    if (group === 'auth' && command === 'login') {
      await login(auth, options, profileName);
      return;
    }
    const profile = await readProfile(profileName);
    const authenticated = await auth.authenticate(profile.id, profile.secret);
    if (authenticated.isError()) {
      print(Result.Error(authenticated.getError()));
      return;
    }
    const identity = authenticated.get();
    if (
      identity.type !== 'machine_authenticated' &&
      group === 'auth' &&
      command === 'logout'
    ) {
      await removeProfile(profileName);
      print(Result.Ok({ type: 'logged_out' }));
      return;
    }
    if (identity.type !== 'machine_authenticated') {
      print(
        Result.Ok({
          ...identity,
          recovery: 'Approve the pending pairing or run pnpm raffy auth login.',
        })
      );
      process.exitCode = 2;
      return;
    }
    const runtime = createRaffyRuntime(db, profile, identity.identity);
    if (group === 'auth') {
      await authCommand(
        auth,
        command,
        options,
        profile,
        profileName,
        identity.identity
      );
      return;
    }
    if (group === 'worker') {
      await workerCommand(runtime, command, profileName);
      return;
    }
    if (group !== 'operations') {
      const access = await checkRaffyAccess(
        runtime,
        group === 'research' && command === 'discover'
          ? 'pipeline'
          : z.enum(['research', 'newsletter', 'pipeline', 'lab']).parse(group)
      );
      if (access.isError()) {
        print(Result.Error(access.getError()));
        return;
      }
      if (access.get().type !== 'authorized') {
        print(Result.Ok(access.get()));
        process.exitCode = 2;
        return;
      }
    }
    if (group === 'research' && command === 'workspace') {
      const workspaceId = z.string().min(1).parse(options.id);
      const found = await runtime.useCases.getWorkspaceConfig({
        currentUserId: identity.identity.userId as Parameters<
          typeof runtime.useCases.getWorkspaceConfig
        >[0]['currentUserId'],
        workspaceId: workspaceId as Parameters<
          typeof runtime.useCases.getWorkspaceConfig
        >[0]['workspaceId'],
      });
      if (found.isError()) {
        print(Result.Error(found.getError()));
        return;
      }
      if (found.get().type !== 'workspace_config') {
        print(Result.Ok(found.get()));
        return;
      }
      await writeProfile({ ...profile, workspaceId }, profileName);
      print(Result.Ok({ type: 'workspace_selected', workspaceId }));
      return;
    }
    const workspaceId =
      group === 'research' && command === 'workspaces'
        ? ''
        : z
            .string()
            .min(1)
            .parse(options.workspace ?? profile.workspaceId);
    const page = zPage.parse({ limit: options.limit, cursor: options.cursor });
    const input =
      typeof options.input === 'string'
        ? JSON.parse(await readFile(options.input, 'utf8'))
        : undefined;
    let result: ApplicationResult<BusinessOutcome>;
    if (
      group === 'pipeline' ||
      group === 'lab' ||
      (group === 'research' && command === 'discover')
    )
      result = await startRaffyOperation(
        runtime,
        group,
        command,
        workspaceId,
        options
      );
    else if (group === 'research')
      result = await researchCommand(
        runtime,
        command,
        workspaceId,
        options,
        page,
        input
      );
    else if (group === 'newsletter')
      result = await newsletterCommand(
        runtime,
        command,
        workspaceId,
        options,
        page,
        input
      );
    else
      result = await operationCommand(
        runtime,
        command,
        workspaceId,
        options,
        page
      );
    result = await finalizeResult(result, group, command, options, profileName);
    print(result);
  } catch (cause) {
    print(
      Result.Error(
        cause instanceof AppError
          ? cause
          : new AppError({
              code: 'CLI_REQUEST_FAILED',
              category:
                cause instanceof z.ZodError || cause instanceof SyntaxError
                  ? 'bad_request'
                  : 'system',
              status: 400,
              message:
                cause instanceof z.ZodError
                  ? 'Invalid arguments. Run pnpm raffy --help.'
                  : 'CLI request failed. Check configuration and authentication.',
              cause,
            })
      )
    );
    process.exitCode = 1;
  } finally {
    await db?.$close();
  }
}

async function login(
  auth: ReturnType<typeof createMachineCredentials>,
  options: ReturnType<typeof parseCommand>['options'],
  profileName: string
) {
  const baseUrl = z
    .url()
    .parse(options['base-url'] ?? readRuntimeEnv().VITE_BASE_URL);
  const url = new URL(baseUrl);
  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
  )
    throw new Error('Use HTTPS or a loopback app URL.');
  const caps = zMachineCapabilities.parse(
    typeof options.capabilities === 'string'
      ? options.capabilities.split(',')
      : [...MACHINE_CAPABILITIES]
  );
  const started = await auth.begin({
    name: typeof options.name === 'string' ? options.name : hostname(),
    capabilities: caps,
  });
  if (started.isError()) {
    print(Result.Error(started.getError()));
    return;
  }
  const pairing = started.get();
  await writeProfile(
    { id: pairing.id, secret: pairing.secret, baseUrl },
    profileName
  );
  const approval = new URL('/app/cli-authorize', baseUrl);
  approval.searchParams.set('request', pairing.id);
  if (!options['no-open']) {
    const opener =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? undefined
          : 'xdg-open';
    if (opener) {
      const child = spawn(opener, [approval.toString()], {
        stdio: 'ignore',
      });
      child.on('error', () => {});
      child.unref();
    }
  }
  print(
    Result.Ok({
      type: 'pairing_started',
      approvalUrl: approval.toString(),
      code: pairing.code,
      expiresAt: pairing.pairingExpiresAt,
      recovery: 'Approve in your browser, then run pnpm raffy auth whoami.',
    })
  );
  return;
}

async function authCommand(
  auth: ReturnType<typeof createMachineCredentials>,
  command: string,
  options: ReturnType<typeof parseCommand>['options'],
  profile: Awaited<ReturnType<typeof readProfile>>,
  profileName: string,
  identity: import('@/modules/auth').MachineIdentity
) {
  if (command === 'whoami')
    print(
      Result.Ok({
        type: 'machine_authenticated',
        identity: identity,
        workspaceId: profile.workspaceId ?? null,
      })
    );
  else if (command === 'list')
    print(
      await auth.list(
        identity.userId,
        zPage.parse({ limit: options.limit, cursor: options.cursor })
      )
    );
  else if (command === 'revoke')
    print(await auth.revoke(identity.userId, z.string().parse(options.id)));
  else {
    print(await auth.revoke(identity.userId, profile.id));
    await removeProfile(profileName);
  }
  return;
}

async function workerCommand(
  runtime: ReturnType<typeof createRaffyRuntime>,
  command: string,
  profileName: string
) {
  if (command === 'status') print(Result.Ok(await workerStatus(profileName)));
  else if (command === 'stop') print(Result.Ok(await stopWorker(profileName)));
  else if (command === 'start')
    print(Result.Ok(await startWorker(profileName)));
  else {
    const controller = new AbortController(),
      release = await ownWorker(profileName, controller);
    if (!release) {
      print(Result.Ok({ type: 'worker_already_running' }));
      return;
    }
    const shutdown = () => controller.abort();
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    try {
      await runRaffyWorker(runtime, controller.signal);
    } finally {
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      await release();
    }
  }
  return;
}

async function finalizeResult(
  result: ApplicationResult<BusinessOutcome>,
  group: string,
  command: string,
  options: ReturnType<typeof parseCommand>['options'],
  profileName: string
) {
  if (result.isOk()) {
    const outcome = result.get();
    if (
      outcome.type === 'operation_queued' ||
      outcome.type === 'operation_exists'
    ) {
      try {
        const worker = await startWorker(profileName);
        result = Result.Ok({ ...outcome, worker });
      } catch {
        result = Result.Ok({
          ...outcome,
          worker: {
            type: 'worker_unavailable',
            recovery: 'Run pnpm raffy worker start.',
          },
        });
      }
    }
    if (
      group === 'newsletter' &&
      command === 'export' &&
      typeof options.out === 'string' &&
      outcome.type === 'draft_exported'
    ) {
      await writeFile(options.out, z.string().parse(outcome.text), {
        flag: 'wx',
        mode: 0o600,
      });
      result = Result.Ok({
        type: 'draft_exported',
        path: options.out,
        warnings: outcome.warnings,
      });
    }
    if (
      [
        'forbidden',
        'not_found',
        'idempotency_conflict',
        'angle_unavailable',
        'selection_conflict',
        'human_authorization_required',
      ].includes(outcome.type)
    )
      process.exitCode = 2;
  } else process.exitCode = 1;
  return result;
}
