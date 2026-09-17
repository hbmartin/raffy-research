/* oxlint-disable no-process-env */
import { createHash, randomBytes } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import { SSR_BASE_URL, SSR_SEED_PASSWORD } from '../tests/support/ssr-e2e';

export const SSR_FIXTURE_DIRECTORY = resolve('.ssr-fixture');
export const SSR_FIXTURE_MANIFEST = resolve(
  SSR_FIXTURE_DIRECTORY,
  'environment.json'
);
export const SSR_DATABASE_PORT = 54331;
export const SSR_COLLECTOR_PORT = 43191;

const inheritedKeys = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'SystemRoot',
  'WINDIR',
  'CI',
  'TERM',
  'FORCE_COLOR',
  'NO_COLOR',
  'PNPM_HOME',
];

export const fixtureEnvironment = (authSecret: string): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(
    inheritedKeys.flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key]]]
    )
  ),
  ALLOW_DEMO_SEED: 'true',
  AUTH_SECRET: authSecret,
  AUTH_PROVIDER: 'better-auth',
  DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${SSR_DATABASE_PORT}/postgres`,
  DATABASE_MIGRATION_URL: `postgresql://postgres:postgres@127.0.0.1:${SSR_DATABASE_PORT}/postgres`,
  DATABASE_DRIVER: 'node-pg',
  DATABASE_MIGRATION_DRIVER: 'node-pg',
  DEMO_SEED_PASSWORD: SSR_SEED_PASSWORD,
  HOST: '127.0.0.1',
  NODE_ENV: 'production',
  PORT: new URL(SSR_BASE_URL).port,
  VITE_PORT: new URL(SSR_BASE_URL).port,
  VITE_BASE_URL: SSR_BASE_URL,
  VITE_ENV_NAME: '',
  VITE_IS_DEMO: 'false',
  VITE_VISUAL_TEST: 'false',
  VITE_SENTRY_DSN: `http://public@127.0.0.1:${SSR_COLLECTOR_PORT}/1`,
  SENTRY_DSN: `http://public@127.0.0.1:${SSR_COLLECTOR_PORT}/1`,
  SENTRY_AUTH_TOKEN: '',
  SENTRY_ORG: '',
  SENTRY_PROJECT: '',
  OTEL_COLLECTOR_URL: `http://127.0.0.1:${SSR_COLLECTOR_PORT}`,
  OTEL_EXPORTER_OTLP_TRACES_HEADERS: 'x-fixture-auth=trace-fixture',
  OTEL_EXPORTER_OTLP_METRICS_HEADERS: 'x-fixture-auth=metric-fixture',
  OTEL_LOCAL_SQLITE_ENABLED: 'false',
  SKIP_ENV_VALIDATION: 'false',
  SSR_FIXTURE_MODE: 'true',
  LOGGER_PRETTY: 'false',
  SSR_FIXTURE_ENV_DIR: resolve(SSR_FIXTURE_DIRECTORY, 'env'),
});

export const createFixtureEnvironment = async () => {
  const env = fixtureEnvironment(randomBytes(32).toString('hex'));
  await mkdir(env.SSR_FIXTURE_ENV_DIR!, { recursive: true });
  return env;
};

const buildOutputDirectory = () => resolve('.output');
const missingBuildOutput = () =>
  new Error('Missing SSR build output; run pnpm build:e2e:ssr first.');

const isMissingPathError = (error: unknown) =>
  error instanceof Error &&
  'code' in error &&
  (error as NodeJS.ErrnoException).code === 'ENOENT';

export const digestBuiltOutput = async () => {
  const root = buildOutputDirectory();
  const hash = createHash('sha256');
  let paths: string[];
  try {
    const serverRoot = resolve(root, 'server');
    const serverEntries = await readdir(serverRoot, { withFileTypes: true });
    const manifests = serverEntries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.startsWith('_tanstack-start-manifest_') &&
          entry.name.endsWith('.mjs')
      )
      .map((entry) => resolve(serverRoot, entry.name))
      .sort();
    if (manifests.length === 0) throw missingBuildOutput();
    paths = [
      resolve(root, 'nitro.json'),
      resolve(serverRoot, 'index.mjs'),
      resolve(serverRoot, '_ssr/ssr.mjs'),
      ...manifests,
    ];
    for (const path of paths) {
      hash.update(relative(root, path).replaceAll('\\', '/'));
      hash.update('\0');
      hash.update(await readFile(path));
      hash.update('\0');
    }
  } catch (error) {
    if (isMissingPathError(error)) throw missingBuildOutput();
    throw error;
  }
  return hash.digest('hex');
};

export const invalidateFixtureManifest = () =>
  rm(SSR_FIXTURE_MANIFEST, { force: true });

export const writeFixtureManifest = async (env: NodeJS.ProcessEnv) => {
  const buildDigest = await digestBuiltOutput();
  const temporary = `${SSR_FIXTURE_MANIFEST}.tmp`;
  // Store only the fixture credential and a fingerprint of the completed build.
  await writeFile(
    temporary,
    JSON.stringify({ authSecret: env.AUTH_SECRET, buildDigest }),
    { mode: 0o600 }
  );
  await rename(temporary, SSR_FIXTURE_MANIFEST);
};

export const readFixtureEnvironment = async () => {
  const manifest: unknown = JSON.parse(
    await readFile(SSR_FIXTURE_MANIFEST, 'utf8')
  );
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !('authSecret' in manifest) ||
    typeof manifest.authSecret !== 'string' ||
    !/^[a-f0-9]{64}$/.test(manifest.authSecret) ||
    !('buildDigest' in manifest) ||
    typeof manifest.buildDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(manifest.buildDigest) ||
    manifest.buildDigest !== (await digestBuiltOutput())
  ) {
    throw new Error(
      'Invalid SSR fixture manifest; run pnpm build:e2e:ssr first.'
    );
  }
  return fixtureEnvironment(manifest.authSecret);
};
