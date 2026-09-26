import { afterEach, expect, it, vi } from 'vitest';

import { readRuntimeEnv } from '@/platform/env/runtime-env';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('reads build-owned flags in a browser with no process global', () => {
  const buildEnv = readRuntimeEnv();
  vi.stubGlobal('process', undefined);
  let env;
  try {
    env = readRuntimeEnv();
  } finally {
    vi.unstubAllGlobals();
  }
  expect(env?.VITE_BASE_URL).toBe(buildEnv.VITE_BASE_URL);
  expect(env?.DEV).toBe(true);
  expect(env?.PROD).toBe(false);
});

it('falls back to NODE_ENV through the real unbundled Node runner', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const directory = await mkdtemp(join(tmpdir(), 'raffy-env-cli-'));
  const script = join(directory, 'probe.ts');
  try {
    await writeFile(
      script,
      `import { readRuntimeEnv } from ${JSON.stringify(resolve('src/platform/env/runtime-env.ts'))}; import { isProductionEnv, isDevelopmentEnv } from ${JSON.stringify(resolve('src/platform/env/merge-runtime-env.ts'))}; const env = readRuntimeEnv(); console.log(JSON.stringify({production:isProductionEnv(env), development:isDevelopmentEnv(env),dev:env.DEV,prod:env.PROD}));`
    );
    const result = spawnSync(process.execPath, ['./run-jiti', script], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        DEV: 'true',
        PROD: 'false',
      },
      timeout: 10_000,
    });
    expect({ status: result.status, stderr: result.stderr }).toMatchObject({
      status: 0,
    });
    expect(JSON.parse(result.stdout)).toEqual({
      production: true,
      development: false,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
