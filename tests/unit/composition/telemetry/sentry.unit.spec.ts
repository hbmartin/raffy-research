import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sentryDataCollection } from '@/composition/telemetry/sentry-data-collection';

const sentryMocks = vi.hoisted(() => ({
  browserTracingIntegration: vi.fn(() => 'browser-tracing'),
  init: vi.fn(),
  tanstackRouterBrowserTracingIntegration: vi.fn(() => 'router-tracing'),
}));

const envClientMock = vi.hoisted(() => ({
  VITE_OTEL_BROWSER_ENABLED: false,
  VITE_SENTRY_DSN: '',
  VITE_SENTRY_ENVIRONMENT: undefined as string | undefined,
  VITE_SENTRY_TUNNEL_PATH: '/api/telemetry/sentry-tunnel',
}));

vi.mock('@sentry/tanstackstart-react', () => ({
  browserTracingIntegration: sentryMocks.browserTracingIntegration,
  init: sentryMocks.init,
  tanstackRouterBrowserTracingIntegration:
    sentryMocks.tanstackRouterBrowserTracingIntegration,
}));

vi.mock('@/platform/env/client', () => ({
  envClient: envClientMock,
}));

describe('Sentry telemetry composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    envClientMock.VITE_SENTRY_DSN = '';
    envClientMock.VITE_SENTRY_ENVIRONMENT = undefined;
    envClientMock.VITE_SENTRY_TUNNEL_PATH = '/api/telemetry/sentry-tunnel';
  });

  it('is a no-op when no client DSN is configured', async () => {
    const { initTelemetryClient } =
      await import('@/composition/telemetry/sentry.client');

    initTelemetryClient({});

    expect(sentryMocks.init).not.toHaveBeenCalled();
    expect(
      sentryMocks.tanstackRouterBrowserTracingIntegration
    ).not.toHaveBeenCalled();
  });

  it('configures browser Sentry for tunneled error capture without tracing', async () => {
    envClientMock.VITE_SENTRY_DSN = 'https://example.com/1';
    const { initTelemetryClient } =
      await import('@/composition/telemetry/sentry.client');

    initTelemetryClient();

    expect(sentryMocks.browserTracingIntegration).not.toHaveBeenCalled();
    expect(
      sentryMocks.tanstackRouterBrowserTracingIntegration
    ).not.toHaveBeenCalled();
    expect(sentryMocks.init).toHaveBeenCalledWith(
      expect.objectContaining({
        beforeSend: expect.any(Function),
        integrations: [],
        dataCollection: sentryDataCollection,
        tracesSampleRate: null,
        tunnel: '/api/telemetry/sentry-tunnel',
      })
    );
  });

  it('passes capture context through to Sentry with primitive tags stringified', async () => {
    const { createSentryTelemetryAdapter } =
      await import('@/composition/telemetry/sentry-adapter');
    const captureException = vi.fn(() => 'event-id');
    const adapter = createSentryTelemetryAdapter({
      captureException,
      setUser: vi.fn(),
      setTag: vi.fn(),
      startSpan: vi.fn((_options, fn) => fn()),
    });
    const error = new Error('boom');

    adapter.captureException(error, {
      fingerprint: ['email-send'],
      level: 'error',
      tags: { attempt: 2, event: 'email.send.failed', retryable: false },
      extra: { statusCode: 401 },
    });

    expect(captureException).toHaveBeenCalledWith(error, {
      fingerprint: ['email-send'],
      level: 'error',
      tags: {
        attempt: '2',
        event: 'email.send.failed',
        retryable: 'false',
      },
      extra: { statusCode: 401 },
    });
  });

  it('sanitizes Sentry event tags, extras, and contexts before send', async () => {
    const { sanitizeSentryEvent } =
      await import('@/composition/telemetry/sentry-adapter');

    expect(
      sanitizeSentryEvent({
        contexts: {
          request: {
            authorization: 'Bearer token',
          },
        },
        extra: {
          email: 'person@example.com',
        },
        tags: {
          attempt: 2,
          email: 'person@example.com',
          event: 'email.send.failed',
          retryable: false,
        },
      })
    ).toEqual({
      contexts: {
        request: {
          authorization: '[REDACTED]',
        },
      },
      extra: {
        email: '[REDACTED]',
      },
      tags: {
        attempt: '2',
        email: '[REDACTED]',
        event: 'email.send.failed',
        retryable: 'false',
      },
    });
  });

  it('retains only User-Agent from Sentry request headers', async () => {
    const { sanitizeSentryEvent } =
      await import('@/composition/telemetry/sentry-adapter');

    expect(
      sanitizeSentryEvent({
        request: {
          headers: {
            authorization: 'Bearer private',
            cookie: 'session=private',
            'user-agent': 'Browser/123',
          },
          method: 'GET',
          url: 'https://app.example/path?token=private',
        },
      }).request
    ).toEqual({
      headers: { 'User-Agent': 'Browser/123' },
      method: 'GET',
      url: 'https://app.example/path',
    });
  });

  it('drops unsupported Sentry event tag values after sanitizing', async () => {
    const { sanitizeSentryEvent } =
      await import('@/composition/telemetry/sentry-adapter');

    expect(
      sanitizeSentryEvent({
        tags: {
          empty: '',
          nested: { value: 'object' },
          nullable: null,
          optional: undefined,
          sequence: ['array'],
          zero: 0,
        },
      })
    ).toEqual({
      contexts: {},
      extra: {},
      tags: {
        empty: '',
        zero: '0',
      },
    });
  });

  it('preserves the specific Sentry event subtype when sanitizing', async () => {
    const { sanitizeSentryEvent } =
      await import('@/composition/telemetry/sentry-adapter');
    type SpecificSentryEvent = {
      contexts?: Record<string, unknown>;
      event_id: string;
      extra?: Record<string, unknown>;
      tags?: Record<string, unknown>;
      type: 'transaction';
    };
    const event: SpecificSentryEvent = {
      event_id: 'event-1',
      extra: {
        authorization: 'Bearer token',
      },
      tags: {
        event: 'auth.failure',
      },
      type: 'transaction',
    };

    const sanitized: SpecificSentryEvent = sanitizeSentryEvent(event);

    expect(sanitized).toEqual({
      contexts: {},
      event_id: 'event-1',
      extra: {
        authorization: '[REDACTED]',
      },
      tags: {
        event: 'auth.failure',
      },
      type: 'transaction',
    });
  });

  it('clears Sentry user tags when the telemetry user is unset', async () => {
    const { createSentryTelemetryAdapter } =
      await import('@/composition/telemetry/sentry-adapter');
    const setUser = vi.fn();
    const setTag = vi.fn();
    const adapter = createSentryTelemetryAdapter({
      captureException: vi.fn(() => 'event-id'),
      setUser,
      setTag,
      startSpan: vi.fn((_options, fn) => fn()),
    });

    adapter.setUser(null);

    expect(setUser).toHaveBeenCalledWith(null);
    expect(setTag).toHaveBeenCalledWith('role', 'none');
  });
});
