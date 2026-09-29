/* oxlint-disable no-process-env */
import { createHash, randomBytes } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
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
const missingRuntimeEntry = () =>
  new Error(
    'Missing SSR runtime entry .output/server/index.mjs; check the Nitro output and pnpm start.'
  );
const invalidFixtureManifest = (cause?: unknown) =>
  new Error('Invalid SSR fixture manifest; run pnpm build:e2e:ssr first.', {
    cause,
  });

const isMissingPathError = (error: unknown) =>
  error instanceof Error &&
  'code' in error &&
  (error as NodeJS.ErrnoException).code === 'ENOENT';

type DeployableFile = { path: string; type: 'file' | 'symlink' };

const collectDeployableFiles = async (
  directory: string
): Promise<DeployableFile[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: DeployableFile[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory())
      paths.push(...(await collectDeployableFiles(path)));
    else if (entry.isFile()) paths.push({ path, type: 'file' });
    else if (entry.isSymbolicLink()) paths.push({ path, type: 'symlink' });
  }
  return paths;
};

const framedHashRecord = (
  hash: ReturnType<typeof createHash>,
  value: string
) => {
  const bytes = Buffer.from(value);
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
};

const validateRuntimeOutput = async (root: string) => {
  let contents: string;
  try {
    contents = await readFile(resolve(root, 'nitro.json'), 'utf8');
  } catch (error) {
    if (isMissingPathError(error)) throw missingBuildOutput();
    throw error;
  }
  let metadata: unknown;
  try {
    metadata = JSON.parse(contents);
  } catch (cause) {
    throw new Error(
      'Malformed SSR metadata in .output/nitro.json: expected a JSON object.',
      { cause }
    );
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    throw new Error(
      'Malformed SSR metadata in .output/nitro.json: expected a JSON object.'
    );
  const { serverEntry, publicDir } = metadata as Record<string, unknown>;
  if (serverEntry !== 'server/index.mjs' || publicDir !== 'public')
    throw new Error(
      `Unsupported Nitro output layout: expected serverEntry="server/index.mjs" and publicDir="public"; observed serverEntry=${JSON.stringify(serverEntry)} and publicDir=${JSON.stringify(publicDir)}.`
    );
  try {
    if (!(await stat(resolve(root, serverEntry))).isFile())
      throw missingRuntimeEntry();
  } catch (error) {
    if (isMissingPathError(error)) throw missingRuntimeEntry();
    throw error;
  }
  try {
    if (!(await stat(resolve(root, publicDir))).isDirectory())
      throw new Error('Missing SSR public directory .output/public.');
  } catch (error) {
    if (isMissingPathError(error))
      throw new Error('Missing SSR public directory .output/public.');
    throw error;
  }
};

export const digestBuiltOutput = async () => {
  const root = buildOutputDirectory();
  const hash = createHash('sha256');
  try {
    await validateRuntimeOutput(root);
    const paths = await collectDeployableFiles(root);
    for (const path of paths
      .map(({ path, type }) => ({
        absolute: path,
        relative: relative(root, path).replaceAll('\\', '/'),
        type,
      }))
      .sort((left, right) => left.relative.localeCompare(right.relative))) {
      const contents =
        path.type === 'symlink'
          ? Buffer.from(await readlink(path.absolute))
          : await readFile(path.absolute);
      framedHashRecord(hash, path.relative);
      framedHashRecord(hash, path.type);
      framedHashRecord(
        hash,
        createHash('sha256').update(contents).digest('hex')
      );
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
  let contents: string;
  try {
    contents = await readFile(SSR_FIXTURE_MANIFEST, 'utf8');
  } catch (error) {
    if (isMissingPathError(error)) throw invalidFixtureManifest(error);
    throw error;
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(contents);
  } catch (error) {
    throw invalidFixtureManifest(error);
  }
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
    throw invalidFixtureManifest();
  }
  return fixtureEnvironment(manifest.authSecret);
};
