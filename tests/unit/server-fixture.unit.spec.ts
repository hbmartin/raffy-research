import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  runtime: {} as Record<string, unknown>,
  build: {} as Record<string, unknown>,
  fetch: vi.fn(async () => new Response('ok')),
}));
vi.mock('../../instrument.server.mjs', () => ({}));
vi.mock('@sentry/tanstackstart-react', () => ({ captureException: vi.fn() }));
vi.mock('@sentry/core/server', () => ({ flushIfServerless: vi.fn() }));
vi.mock('@/composition/telemetry/sentry.server', () => ({
  initTelemetryServer: vi.fn(),
}));
vi.mock('@/composition/telemetry/otel.server', () => ({
  runWithServerTelemetryUserContext: (fn: () => unknown) => fn(),
  captureServerTelemetryUserContext: () => (fn: () => unknown) => fn(),
  closeServerTelemetryUserContext: vi.fn(),
}));
vi.mock('@tanstack/react-start/server-entry', () => ({
  default: { fetch: state.fetch },
  createServerEntry: (entry: unknown) => entry,
}));
vi.mock('@/platform/env/runtime-env', async () => {
  const { mergeRuntimeEnv } = await import('@/platform/env/merge-runtime-env');
  return { readRuntimeEnv: () => mergeRuntimeEnv(state.runtime, state.build) };
});
beforeEach(() => {
  vi.resetModules();
  state.runtime = {
    NODE_ENV: 'production',
    SSR_FIXTURE_MODE: 'true',
    HOST: '127.0.0.1',
    AUTH_SECRET: 'a'.repeat(32),
    SKIP_ENV_VALIDATION: 'false',
    VITE_BASE_URL: 'https://runtime.invalid',
  };
  state.build = {
    DEV: false,
    PROD: true,
    VITE_BASE_URL: 'http://127.0.0.1:3011',
  };
  vi.stubEnv('RAFFY_PRODUCTION_BUILD', 'true');
});
afterEach(() => vi.unstubAllEnvs());

it('uses the real validator with explicit build/runtime URL differences', async () => {
  const server = (await import('@/server')).default;
  for (const [url, allowed] of [
    ['http://127.0.0.1:3011/', true],
    ['https://external.test/', false],
  ] as const) {
    const response = await server.fetch(new Request(url), {
      context: { requestId: 'fixture' },
    });
    await response.text();
    expect(state.fetch).toHaveBeenLastCalledWith(
      expect.any(Request),
      expect.objectContaining({
        context: expect.objectContaining({
          allowPlaywrightScreenshotStyles: allowed,
        }),
      })
    );
  }
});

it.each([
  [
    'development artifact',
    { NODE_ENV: 'production' },
    { DEV: true, PROD: false },
    'false',
  ],
  ['absent runtime marker', { NODE_ENV: undefined }, {}, 'true'],
  ['conflicting runtime marker', { NODE_ENV: 'development' }, {}, 'true'],
  ['external host', { HOST: '0.0.0.0' }, {}, 'true'],
  ['external Nitro host', { NITRO_HOST: '0.0.0.0' }, {}, 'true'],
  [
    'external built URL',
    { VITE_BASE_URL: 'http://127.0.0.1:3011' },
    { VITE_BASE_URL: 'https://external.test' },
    'true',
  ],
  ['validation bypass', { SKIP_ENV_VALIDATION: 'true' }, {}, 'true'],
  ['invalid auth', { AUTH_SECRET: 'short' }, {}, 'true'],
] as const)(
  'rejects %s through the real server entry',
  async (_name, runtime, build, marker) => {
    Object.assign(state.runtime, runtime);
    Object.assign(state.build, build);
    vi.stubEnv('RAFFY_PRODUCTION_BUILD', marker);
    await expect(import('@/server')).rejects.toThrow();
    expect(state.fetch).not.toHaveBeenCalled();
  }
);
