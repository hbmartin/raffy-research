import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initSentry: vi.fn(() => false),
  otel: vi.fn(),
  set: vi.fn(),
}));
vi.mock('@/composition/telemetry/sentry-bootstrap.server', () => ({
  initSentryServer: mocks.initSentry,
}));
vi.mock('@/composition/telemetry/otel.server', () => ({
  initOpenTelemetryServer: mocks.otel,
}));
vi.mock('@/composition/telemetry/index', () => ({ setTelemetry: mocks.set }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.initSentry.mockReturnValue(false);
  mocks.otel.mockReturnValue(undefined);
});

describe('server telemetry initialization', () => {
  it('composes the initialized adapters only once', async () => {
    const adapter = { flush: vi.fn() };
    mocks.otel.mockReturnValue(adapter);
    const { initTelemetryServer } =
      await import('@/composition/telemetry/sentry.server');

    initTelemetryServer();
    initTelemetryServer();

    expect(mocks.initSentry).toHaveBeenCalledOnce();
    expect(mocks.otel).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledOnce();
  });

  it('lets configuration errors fail startup and remains retryable', async () => {
    const configurationError = new Error('invalid collector configuration');
    mocks.otel.mockImplementationOnce(() => {
      throw configurationError;
    });
    const { initTelemetryServer } =
      await import('@/composition/telemetry/sentry.server');

    expect(initTelemetryServer).toThrow(configurationError);
    expect(mocks.set).not.toHaveBeenCalled();

    mocks.otel.mockReturnValue(undefined);
    initTelemetryServer();
    expect(mocks.otel).toHaveBeenCalledTimes(2);
    expect(mocks.set).toHaveBeenCalledOnce();
  });
});
