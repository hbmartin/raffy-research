import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServerEntry: vi.fn((entry: unknown) => entry),
  handlerFetch: vi.fn(async () => new Response('ok')),
  captureException: vi.fn(),
  initialize: vi.fn(),
  runWithUserContext: vi.fn(<T>(fn: () => T) => fn()),
  captureUserContext: vi.fn(
    () =>
      <T>(fn: () => T) =>
        fn()
  ),
}));

vi.mock('@sentry/tanstackstart-react', () => ({
  captureException: mocks.captureException,
}));

vi.mock('@/composition/telemetry/sentry.server', () => ({
  initTelemetryServer: mocks.initialize,
}));

vi.mock('@/composition/telemetry/otel.server', () => ({
  runWithServerTelemetryUserContext: mocks.runWithUserContext,
  captureServerTelemetryUserContext: mocks.captureUserContext,
}));

vi.mock('@tanstack/react-start/server-entry', () => ({
  default: {
    fetch: mocks.handlerFetch,
  },
  createServerEntry: mocks.createServerEntry,
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('server entry', () => {
  it('passes a request id through Start request context', async () => {
    const server = (await import('@/server')).default as {
      fetch: (request: Request) => Promise<Response>;
    };
    const request = new Request('https://app.example/');

    const response = await server.fetch(request);
    expect(await response.text()).toBe('ok');
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    expect(mocks.runWithUserContext).toHaveBeenCalledTimes(1);

    expect(mocks.handlerFetch).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        context: {
          allowPlaywrightScreenshotStyles: false,
          requestId: expect.any(String),
        },
      })
    );
  });

  it('enables screenshot styles only for the validated loopback SSR fixture', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PROD', true);
    vi.stubEnv('SSR_FIXTURE_MODE', 'true');
    vi.stubEnv('HOST', '127.0.0.1');
    vi.stubEnv('VITE_BASE_URL', 'http://127.0.0.1:3011');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
    const server = (await import('@/server')).default as {
      fetch: (request: Request) => Promise<Response>;
    };
    const request = new Request('http://127.0.0.1:3011/');

    await server.fetch(request);

    expect(mocks.handlerFetch).toHaveBeenLastCalledWith(
      request,
      expect.objectContaining({
        context: expect.objectContaining({
          allowPlaywrightScreenshotStyles: true,
        }),
      })
    );
    await server.fetch(new Request('http://example.test/'));
    expect(mocks.handlerFetch).toHaveBeenLastCalledWith(
      expect.any(Request),
      expect.objectContaining({
        context: expect.objectContaining({
          allowPlaywrightScreenshotStyles: false,
        }),
      })
    );
  });

  it('fails startup when a fixture marker is present in a non-production runtime', async () => {
    vi.resetModules();
    vi.stubEnv('PROD', true);
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SSR_FIXTURE_MODE', 'true');
    vi.stubEnv('HOST', '127.0.0.1');
    vi.stubEnv('VITE_BASE_URL', 'http://127.0.0.1:3011');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));

    await expect(import('@/server')).rejects.toThrow('production build');
  });
});
