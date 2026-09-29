import { describe, expect, it } from 'vitest';

import {
  isDevelopmentEnv,
  isProductionEnv,
  mergeRuntimeEnv,
} from '@/platform/env/merge-runtime-env';

describe('mergeRuntimeEnv', () => {
  it.each([undefined, 'development', 'production'])(
    'uses production artifact flags despite NODE_ENV=%s',
    (NODE_ENV) => {
      const env = mergeRuntimeEnv(
        { NODE_ENV, DEV: 'true', PROD: 'false' },
        { DEV: false, PROD: true }
      );
      expect(isDevelopmentEnv(env)).toBe(false);
      expect(isProductionEnv(env)).toBe(true);
    }
  );

  it.each([true, 'true'])(
    'preserves development flags for a browser without process: %s',
    (DEV) => {
      const env = mergeRuntimeEnv(
        {},
        { DEV, PROD: DEV === true ? false : 'false' }
      );
      expect(isDevelopmentEnv(env)).toBe(true);
      expect(isProductionEnv(env)).toBe(false);
    }
  );

  it('keeps dev server semantics even with a conflicting runtime NODE_ENV', () => {
    const env = mergeRuntimeEnv(
      { NODE_ENV: 'production' },
      { DEV: true, PROD: false }
    );
    expect(isDevelopmentEnv(env)).toBe(true);
    expect(isProductionEnv(env)).toBe(false);
  });

  it.each(['production', 'development', undefined])(
    'falls back to NODE_ENV only for unbundled tools: %s',
    (NODE_ENV) => {
      const env = mergeRuntimeEnv({ NODE_ENV, DEV: 'true', PROD: 'true' });
      expect(isDevelopmentEnv(env)).toBe(NODE_ENV === 'development');
      expect(isProductionEnv(env)).toBe(NODE_ENV === 'production');
    }
  );

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
