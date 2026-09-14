import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServerEntry: vi.fn((entry: unknown) => entry),
  handlerFetch: vi.fn(async () => new Response('ok')),
  captureException: vi.fn(),
  initialize: vi.fn(),
}));

vi.mock('@sentry/tanstackstart-react', () => ({
  captureException: mocks.captureException,
}));

vi.mock('@/composition/telemetry/sentry.server', () => ({
  initTelemetryServer: mocks.initialize,
}));

vi.mock('@tanstack/react-start/server-entry', () => ({
  default: {
    fetch: mocks.handlerFetch,
  },
  createServerEntry: mocks.createServerEntry,
}));

describe('server entry', () => {
  it('passes a request id through Start request context', async () => {
    const server = (await import('@/server')).default as {
      fetch: (request: Request) => Promise<Response>;
    };
    const request = new Request('https://app.example/');

    const response = await server.fetch(request);
    expect(await response.text()).toBe('ok');
    expect(mocks.initialize).toHaveBeenCalledTimes(1);

    expect(mocks.handlerFetch).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        context: {
          requestId: expect.any(String),
        },
      })
    );
  });
});
