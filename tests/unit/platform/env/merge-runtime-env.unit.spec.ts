import { describe, expect, it } from 'vitest';

import { mergeRuntimeEnv } from '@/platform/env/merge-runtime-env';

describe('mergeRuntimeEnv', () => {
  it('keeps build-time VITE values while retaining private runtime values', () => {
    expect(
      mergeRuntimeEnv(
        {
          NODE_ENV: 'production',
          AUTH_SECRET: 'runtime-secret',
          VITE_BASE_URL: 'http://127.0.0.1:3011',
          VITE_SENTRY_DSN: 'https://runtime.example/1',
        },
        {
          VITE_BASE_URL: 'https://built.example',
          VITE_SENTRY_DSN: 'https://built.example/1',
        }
      )
    ).toMatchObject({
      NODE_ENV: 'production',
      AUTH_SECRET: 'runtime-secret',
      VITE_BASE_URL: 'https://built.example',
      VITE_SENTRY_DSN: 'https://built.example/1',
    });
  });
});
