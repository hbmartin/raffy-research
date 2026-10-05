import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { readRuntimeEnv } from '@/platform/env/runtime-env';

import { readProfile } from './profile';
import { workerStatus } from './worker-process';

const execute = promisify(execFile);
async function nativeDependency(provider: string, binary: string) {
  try {
    await execute(binary, ['--version'], { timeout: 3000, maxBuffer: 16_384 });
    return { provider, available: true };
  } catch {
    return { provider, available: false };
  }
}
export async function doctor(profile: string) {
  const env = readRuntimeEnv();
  const nativeProviders = await Promise.all([
    nativeDependency('codex-cli', 'codex'),
    nativeDependency('claude-code', 'claude'),
    nativeDependency('ollama', 'ollama'),
  ]);
  let credentialFile = 'missing_or_not_private';
  try {
    await readProfile(profile);
    credentialFile = 'private_profile_found';
  } catch {
    // Dependency inspection never prints credentials or filesystem contents.
  }
  return {
    type: 'doctor_result',
    node: process.versions.node,
    supportedNode: Number(process.versions.node.split('.')[0]) === 24,
    databaseConfigured: Boolean(env.DATABASE_URL),
    databaseDriver:
      typeof env.DATABASE_DRIVER === 'string' ? env.DATABASE_DRIVER : 'node-pg',
    appUrlConfigured: Boolean(env.VITE_BASE_URL),
    credentialFile,
    nativeProviders,
    worker: await workerStatus(profile),
    recovery:
      'Configure database access and an available native provider; run auth whoami to validate approval/expiry, or auth login for browser pairing.',
  };
}
