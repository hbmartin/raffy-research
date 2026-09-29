import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sentryDataCollection } from '@/composition/telemetry/sentry-data-collection';

const mocks = vi.hoisted(() => ({
  defaults: vi.fn(() => [
    { name: 'Http' },
    { name: 'RequestData' },
    { name: 'NodeFetch' },
  ]),
  getConfig: vi.fn(),
  init: vi.fn(),
}));

vi.mock('@sentry/tanstackstart-react', () => ({
  getDefaultIntegrationsWithoutPerformance: mocks.defaults,
  init: mocks.init,
}));
vi.mock('@/modules/kernel/infrastructure/config/telemetry', () => ({
  getSentryServerConfig: mocks.getConfig,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.getConfig.mockReturnValue({});
});

describe('early Sentry server bootstrap', () => {
  it('configures one sanitized, environment-tagged, error-only client', async () => {
    mocks.getConfig.mockReturnValue({
      dsn: 'https://public@sentry.example/1',
      environment: 'production',
    });
    const { initSentryServer } =
      await import('@/composition/telemetry/sentry-bootstrap.server');

    expect(initSentryServer()).toBe(true);
    expect(initSentryServer()).toBe(true);
    expect(mocks.init).toHaveBeenCalledOnce();
    expect(mocks.defaults).toHaveBeenCalledOnce();

    const options = mocks.init.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      defaultIntegrations: [
        { name: 'Http' },
        { name: 'RequestData' },
        { name: 'NodeFetch' },
      ],
      dsn: 'https://public@sentry.example/1',
      environment: 'production',
      dataCollection: sentryDataCollection,
      enableOpenTelemetrySetup: false,
      tracesSampleRate: null,
    });
    expect(
      options.beforeSend({
        contexts: { request: { authorization: 'Bearer private' } },
      })
    ).toMatchObject({
      contexts: { request: { authorization: '[REDACTED]' } },
    });
  });

  it('does not initialize without a DSN', async () => {
    const { initSentryServer } =
      await import('@/composition/telemetry/sentry-bootstrap.server');

    expect(initSentryServer()).toBe(false);
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('contains an SDK failure, emits one redacted diagnostic, and never retries', async () => {
    mocks.getConfig.mockReturnValue({
      dsn: 'https://secret@sentry.example/1',
    });
    mocks.init.mockImplementation(() => {
      throw new Error('secret startup failure');
    });
    const diagnostic = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const { initSentryServer } =
      await import('@/composition/telemetry/sentry-bootstrap.server');

    expect(initSentryServer()).toBe(false);
    expect(initSentryServer()).toBe(false);
    expect(mocks.init).toHaveBeenCalledOnce();
    expect(diagnostic).toHaveBeenCalledOnce();
    expect(String(diagnostic.mock.calls[0]?.[0])).toContain(
      'telemetry.sentry_init_failed'
    );
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('secret');
  });
});
