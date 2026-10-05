import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';

import { profileDirectory, profilePath } from './profile';

const zWorker = z.object({
  pid: z.number().int(),
  instanceId: z.uuid(),
  heartbeatAt: z.number(),
  stopping: z.boolean().optional(),
});
const directory = (profile = 'default') => {
  profilePath(profile);
  return join(profileDirectory(), `${profile}.worker`);
};
export async function workerStatus(profile?: string) {
  try {
    const state = zWorker.parse(
      JSON.parse(await readFile(join(directory(profile), 'state.json'), 'utf8'))
    );
    return {
      type: 'worker_status',
      running: Date.now() - state.heartbeatAt < 45_000,
      pid: state.pid,
      stopping: state.stopping ?? false,
    };
  } catch {
    return { type: 'worker_status', running: false };
  }
}
export async function startWorker(profile = 'default') {
  if ((await workerStatus(profile)).running)
    return { type: 'worker_already_running' };
  await mkdir(profileDirectory(), { recursive: true, mode: 0o700 });
  const logPath = join(profileDirectory(), `${profile}.worker.log`);
  const log = await open(logPath, 'a', 0o600);
  const child = spawn(
    process.execPath,
    [
      resolve('run-jiti'),
      resolve('scripts/raffy.ts'),
      'worker',
      'run',
      '--profile',
      profile,
    ],
    { detached: true, stdio: ['ignore', log.fd, log.fd], cwd: process.cwd() }
  );
  const launched = await new Promise<boolean>((resolve) => {
    child.once('spawn', () => resolve(true));
    child.once('error', () => resolve(false));
  });
  child.unref();
  await log.close();
  return launched
    ? { type: 'worker_starting', pid: child.pid, logPath }
    : { type: 'worker_unavailable', logPath };
}
export async function stopWorker(profile?: string) {
  const state = await workerStatus(profile);
  if (!state.running) return { type: 'worker_not_running' };
  await writeFile(join(directory(profile), 'stop'), '', { mode: 0o600 });
  return { type: 'worker_stop_requested' };
}
export async function ownWorker(
  profile: string | undefined,
  controller: AbortController
) {
  const path = directory(profile),
    instanceId = randomUUID();
  if ((await workerStatus(profile)).running) return undefined;
  // mkdir is the cross-process startup lock; stale directories have no live heartbeat.
  try {
    await mkdir(path, { mode: 0o700 });
  } catch {
    const age = Date.now() - (await stat(path)).mtimeMs;
    if (age < 45_000) return undefined;
    await rm(path, { recursive: true, force: true });
    await mkdir(path, { mode: 0o700 });
  }
  const statePath = join(path, 'state.json');
  const write = async () => {
    const temporary = join(path, `${randomUUID()}.state`);
    await writeFile(
      temporary,
      JSON.stringify({
        pid: process.pid,
        instanceId,
        heartbeatAt: Date.now(),
        stopping: controller.signal.aborted,
      }),
      { mode: 0o600 }
    );
    await rename(temporary, statePath);
  };
  await write();
  const timer = setInterval(() => {
    void (async () => {
      try {
        await stat(join(path, 'stop'));
        controller.abort();
      } catch {
        /* No stop requested. */
      }
      await write();
    })().catch(() => controller.abort());
  }, 1000);
  return async () => {
    clearInterval(timer);
    const state = zWorker.parse(JSON.parse(await readFile(statePath, 'utf8')));
    if (state.instanceId === instanceId)
      await rm(path, { recursive: true, force: true });
  };
}
