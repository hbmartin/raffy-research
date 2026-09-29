import type { ConfigEnv, UserConfig } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  babel: vi.fn(() => ({ name: 'babel' })),
  clientEnv: {} as Record<string, string>,
  createNitro: vi.fn(async () => ({ name: 'isolated-nitro' })),
  devtools: vi.fn(() => [{ name: 'devtools' }]),
  loadEnv: vi.fn(),
  nitro: vi.fn(() => ({ name: 'nitro' })),
  privateEnv: {} as Record<string, string>,
  sentry: vi.fn(() => [{ name: 'sentry-upload' }]),
  tanstackStart: vi.fn(() => ({ name: 'tanstack-start' })),
  viteReact: vi.fn(() => ({ name: 'vite-react' })),
}));

vi.mock('@rolldown/plugin-babel', () => ({ default: mocks.babel }));
vi.mock('@sentry/tanstackstart-react/vite', () => ({
  sentryTanstackStart: mocks.sentry,
}));
vi.mock('@tanstack/devtools-vite', () => ({ devtools: mocks.devtools }));
vi.mock('@tanstack/react-start/plugin/vite', () => ({
  tanstackStart: mocks.tanstackStart,
}));
vi.mock('@vitejs/plugin-react', () => ({
  default: mocks.viteReact,
  reactCompilerPreset: () => 'react-compiler-preset',
}));
vi.mock('nitro/vite', () => ({ nitro: mocks.nitro }));
vi.mock('nitro/builder', () => ({ createNitro: mocks.createNitro }));
vi.mock('vite', () => ({
  defineConfig: (config: unknown) => config,
  loadEnv: mocks.loadEnv,
}));

import viteConfig from '../../../vite.config';

type ConfigFactory = (input: ConfigEnv) => Promise<UserConfig>;

const createConfig = viteConfig as unknown as ConfigFactory;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SSR_FIXTURE_ENV_DIR', undefined);
  for (const key of Object.keys(mocks.clientEnv)) delete mocks.clientEnv[key];
  for (const key of Object.keys(mocks.privateEnv)) delete mocks.privateEnv[key];
  mocks.loadEnv.mockImplementation(
    (_mode: string, _directory: string, prefix: string) =>
      prefix === 'VITE_' ? mocks.clientEnv : mocks.privateEnv
  );
});
afterEach(() => vi.unstubAllEnvs());

describe('Vite Sentry upload configuration', () => {
  it('omits the upload plugin when any private credential is missing', async () => {
    mocks.clientEnv.VITE_SENTRY_DSN = 'https://public@sentry.example/1';
    mocks.privateEnv.SENTRY_ORG = 'example-org';
    mocks.privateEnv.SENTRY_PROJECT = 'example-project';

    const config = await createConfig({ mode: 'production', command: 'build' });

    expect(mocks.sentry).not.toHaveBeenCalled();
    expect(config.plugins).not.toContainEqual({ name: 'sentry-upload' });
  });

  it('enables upload with a narrowed, unconditional configuration', async () => {
    mocks.clientEnv.VITE_SENTRY_DSN = 'https://public@sentry.example/1';
    mocks.privateEnv.SENTRY_AUTH_TOKEN = 'sentry-token';
    mocks.privateEnv.SENTRY_ORG = 'example-org';
    mocks.privateEnv.SENTRY_PROJECT = 'example-project';

    const config = await createConfig({ mode: 'production', command: 'build' });

    expect(mocks.sentry).toHaveBeenCalledWith({
      authToken: 'sentry-token',
      autoInstrumentMiddleware: false,
      org: 'example-org',
      project: 'example-project',
      release: { create: true, finalize: true },
      sourcemaps: { disable: false },
      telemetry: false,
    });
    expect(config.plugins).toContainEqual({ name: 'sentry-upload' });
  });
});

it('isolates the fixture from both Vite and Nitro dotenv loading', async () => {
  vi.stubEnv('SSR_FIXTURE_ENV_DIR', '/fixture-env');
  await createConfig({ mode: 'staging', command: 'build' });
  expect(mocks.loadEnv).toHaveBeenCalledWith(
    'staging',
    '/fixture-env',
    'VITE_'
  );
  expect(mocks.createNitro).toHaveBeenCalledWith(
    expect.objectContaining({ builder: 'vite', dev: false }),
    { dotenv: false }
  );
  expect(mocks.nitro).toHaveBeenCalledWith(
    expect.objectContaining({ _nitro: { name: 'isolated-nitro' } })
  );
});
