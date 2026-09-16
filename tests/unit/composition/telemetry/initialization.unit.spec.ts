import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  otel: vi.fn(),
  set: vi.fn(),
}));
vi.mock('@sentry/tanstackstart-react', () => ({ init: mocks.init }));
vi.mock('@/composition/telemetry/otel.server', () => ({
  initOpenTelemetryServer: mocks.otel,
}));
vi.mock('@/composition/telemetry/index', () => ({ setTelemetry: mocks.set }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('server telemetry initialization', () => {
  it('does not mark a rejected configuration initialized', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('OTEL_COLLECTOR_URL', 'https://collector.example');
    vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', 'x-token=private%0Avalue');
    const { initTelemetryServer } =
      await import('@/composition/telemetry/sentry.server');
    expect(initTelemetryServer).toThrow('OTEL_EXPORTER_OTLP_HEADERS');
    expect(mocks.otel).not.toHaveBeenCalled();
    vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', 'x-token=valid');
    vi.stubEnv('SENTRY_DSN', 'https://public@sentry.example/1');
    initTelemetryServer();
    initTelemetryServer();
    expect(mocks.otel).toHaveBeenCalledTimes(1);
    expect(mocks.init).toHaveBeenCalledTimes(1);
  });

  it('initializes Sentry with an inactive malformed collector configuration', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OTEL_COLLECTOR_URL', undefined);
    vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', 'x-token=private%0Avalue');
    vi.stubEnv('SENTRY_DSN', 'https://public@sentry.example/1');
    const { initTelemetryServer } =
      await import('@/composition/telemetry/sentry.server');
    initTelemetryServer();
    expect(mocks.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://public@sentry.example/1',
        tracesSampleRate: 0,
      })
    );
  });

  it('keeps serving and does not retry an unexpected SDK initialization failure', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OTEL_COLLECTOR_URL', 'https://collector.example');
    mocks.otel.mockImplementation(() => {
      throw new Error('SDK setup failed');
    });
    const diagnostic = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const { initTelemetryServer } =
      await import('@/composition/telemetry/sentry.server');
    expect(initTelemetryServer).not.toThrow();
    initTelemetryServer();
    expect(mocks.otel).toHaveBeenCalledTimes(1);
    expect(diagnostic).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(
      'SDK setup failed'
    );
    diagnostic.mockRestore();
  });
});
