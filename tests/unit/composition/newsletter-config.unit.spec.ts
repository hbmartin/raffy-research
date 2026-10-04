import { describe, expect, it } from 'vitest';

import { newsletterExecutionConfig } from '@/composition/newsletter-config';

describe('Newsletter execution allowances', () => {
  it('defaults hosted work to 640 seconds with a 600-second call, independently of local draining', () => {
    expect(newsletterExecutionConfig({})).toMatchObject({
      durationSeconds: 800,
      hostedTimeoutMs: 600000,
      localTimeoutMs: 600000,
      localWorkSeconds: 900,
      persistenceReserveMs: 30000,
    });
  });
  it('extends local draining for a longer configured local timeout', () => {
    expect(
      newsletterExecutionConfig({ LOCAL_AI_TIMEOUT_MS: '1200000' })
    ).toMatchObject({ localTimeoutMs: 1200000, localWorkSeconds: 1260 });
  });
  it.each([
    { NEWSLETTER_INVOCATION_SECONDS: '300' },
    { NEWSLETTER_HOSTED_TIMEOUT_MS: '620000' },
    { LOCAL_AI_TIMEOUT_MS: '-1' },
    { NEWSLETTER_LOCAL_WORK_SECONDS: '600' },
    { NEWSLETTER_INVOCATION_SECONDS: '801' },
  ])(
    'rejects execution settings that cannot fit a fresh invocation: %j',
    (settings) => {
      expect(() => newsletterExecutionConfig(settings)).toThrow();
    }
  );
  it('accepts an explicit smaller provider timeout with a matching invocation duration', () => {
    expect(
      newsletterExecutionConfig({
        NEWSLETTER_INVOCATION_SECONDS: '300',
        NEWSLETTER_HOSTED_TIMEOUT_MS: '200000',
      })
    ).toMatchObject({ hostedTimeoutMs: 200000, durationSeconds: 300 });
  });
});
