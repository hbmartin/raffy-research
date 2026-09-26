import {
  Client,
  requestDataIntegration,
  Scope,
  serializeEnvelope,
  type Envelope,
  type ClientOptions,
} from '@sentry/core';
import { describe, expect, it } from 'vitest';

import { sanitizeSentryEvent } from '@/composition/telemetry/sentry-adapter';
import { sentryDataCollection } from '@/composition/telemetry/sentry-data-collection';

class TestClient extends Client {
  constructor(options: ClientOptions) {
    super(options);
  }
  async eventFromException(): Promise<never> {
    throw new Error('Use captureEvent in this envelope test');
  }
  async eventFromMessage(): Promise<never> {
    throw new Error('Use captureEvent in this envelope test');
  }
}

describe('Sentry outgoing privacy boundary', () => {
  it.each([
    'password=credential-sentinel',
    { email: 'private@example.test', password: 'credential-sentinel' },
    [['password', 'credential-sentinel']],
  ])(
    'removes request and identity payloads from the actual SDK envelope: %j',
    async (data) => {
      const envelopes: Envelope[] = [];
      const client = new TestClient({
        dsn: 'https://public@sentry.example/1',
        stackParser: () => [],
        integrations: [requestDataIntegration()],
        dataCollection: sentryDataCollection,
        beforeSend: sanitizeSentryEvent,
        transport: () => ({
          send: async (envelope) => {
            envelopes.push(envelope);
            return { statusCode: 200 };
          },
          flush: async () => true,
        }),
      });
      client.init();
      const scope = new Scope();
      scope.setClient(client);
      scope.setSDKProcessingMetadata({
        normalizedRequest: {
          method: 'POST',
          url: 'https://credential-sentinel:credential-sentinel@app.example/api/auth/sign-in/email?token=credential-sentinel#credential-sentinel',
          headers: {
            authorization: 'credential-sentinel',
            'x-forwarded-for': '203.0.113.99',
            'user-agent': 'Browser/123',
          },
          cookies: { session: 'credential-sentinel' },
          query_string: { password: 'credential-sentinel' },
          env: { secret: 'credential-sentinel' },
          data,
        },
        ipAddress: '203.0.113.99',
      });
      scope.setUser({
        id: 'opaque-user-123',
        segment: 'analyst',
        email: 'private@example.test',
        ip_address: '203.0.113.99',
        username: 'credential-sentinel',
      });
      try {
        client.captureEvent(
          {
            event_id: '0123456789abcdef0123456789abcdef',
            fingerprint: ['auth-error'],
            exception: {
              values: [
                {
                  type: 'Error',
                  value: 'Sign-in failed',
                  stacktrace: {
                    frames: [
                      { filename: 'auth.ts', function: 'signIn', lineno: 12 },
                    ],
                  },
                },
              ],
            },
            contexts: {
              trace: {
                trace_id: 'abcdef0123456789abcdef0123456789',
                span_id: '0123456789abcdef',
              },
            },
            tags: { requestId: 'request-123' },
          },
          {},
          scope
        );
        await client.flush(1_000);
        expect(envelopes).toHaveLength(1);
        const serialized = serializeEnvelope(envelopes[0]!);
        const text =
          typeof serialized === 'string'
            ? serialized
            : new TextDecoder().decode(serialized);
        for (const secret of [
          'credential-sentinel',
          'private@example.test',
          '203.0.113.99',
        ])
          expect(text).not.toContain(secret);
        const event = envelopes[0]![1][0]![1];
        expect(event).toMatchObject({
          event_id: '0123456789abcdef0123456789abcdef',
          request: {
            headers: { 'User-Agent': 'Browser/123' },
            method: 'POST',
            url: 'https://app.example/api/auth/sign-in/email',
          },
          user: { id: 'opaque-user-123', segment: 'analyst' },
          fingerprint: ['auth-error'],
          tags: { requestId: 'request-123' },
          exception: {
            values: [
              {
                stacktrace: {
                  frames: [
                    { filename: 'auth.ts', function: 'signIn', lineno: 12 },
                  ],
                },
              },
            ],
          },
        });
      } finally {
        await client.close();
      }
    }
  );

  it.each([
    'not a url?password=credential-sentinel',
    'javascript:credential-sentinel',
  ])('drops malformed or non-HTTP URLs: %s', (url) => {
    expect(
      sanitizeSentryEvent({ request: { url }, extra: {} }).request.url
    ).toBeUndefined();
  });
});
