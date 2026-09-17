import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  babel: vi.fn(() => ({ name: 'babel' })),
  clientEnv: {} as Record<string, string>,
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
vi.mock('vite', () => ({
  defineConfig: (config: unknown) => config,
  loadEnv: mocks.loadEnv,
}));

import viteConfig from '../../../vite.config';

type ConfigFactory = (input: { mode: string }) => {
  plugins: Array<{ name?: string }>;
};

const createConfig = viteConfig as unknown as ConfigFactory;

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mocks.clientEnv)) delete mocks.clientEnv[key];
  for (const key of Object.keys(mocks.privateEnv)) delete mocks.privateEnv[key];
  mocks.loadEnv.mockImplementation(
    (_mode: string, _directory: string, prefix: string) =>
      prefix === 'VITE_' ? mocks.clientEnv : mocks.privateEnv
  );
});

describe('Vite Sentry upload configuration', () => {
  it('omits the upload plugin when any private credential is missing', () => {
    mocks.clientEnv.VITE_SENTRY_DSN = 'https://public@sentry.example/1';
    mocks.privateEnv.SENTRY_ORG = 'example-org';
    mocks.privateEnv.SENTRY_PROJECT = 'example-project';

    const config = createConfig({ mode: 'production' });

    expect(mocks.sentry).not.toHaveBeenCalled();
    expect(config.plugins).not.toContainEqual({ name: 'sentry-upload' });
  });

  it('enables upload with a narrowed, unconditional configuration', () => {
    mocks.clientEnv.VITE_SENTRY_DSN = 'https://public@sentry.example/1';
    mocks.privateEnv.SENTRY_AUTH_TOKEN = 'sentry-token';
    mocks.privateEnv.SENTRY_ORG = 'example-org';
    mocks.privateEnv.SENTRY_PROJECT = 'example-project';

    const config = createConfig({ mode: 'production' });

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
