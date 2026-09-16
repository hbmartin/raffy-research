import { afterEach, describe, expect, it, vi } from 'vitest';

const clearBaseUrlEnvironment = () => {
  vi.stubEnv('VITE_BASE_URL', undefined);
  vi.stubEnv('VITE_VERCEL_ENV', undefined);
  vi.stubEnv('VITE_VERCEL_BRANCH_URL', undefined);
  vi.stubEnv('VITE_VERCEL_URL', undefined);
  vi.stubEnv('VERCEL_ENV', undefined);
  vi.stubEnv('VERCEL_BRANCH_URL', undefined);
  vi.stubEnv('VERCEL_URL', undefined);
};

describe('client environment config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses Vite-prefixed Vercel values during a Preview build', async () => {
    clearBaseUrlEnvironment();
    vi.stubEnv('VITE_VERCEL_ENV', 'preview');
    vi.stubEnv('VITE_VERCEL_BRANCH_URL', 'preview-build.example');

    const { getEnvClient } = await import('@/platform/env/config');

    expect(getEnvClient().VITE_BASE_URL).toBe('https://preview-build.example');
  });

  it('uses server-runtime Vercel values during Preview SSR', async () => {
    clearBaseUrlEnvironment();
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_BRANCH_URL', 'preview-runtime.example');

    const { getEnvClient } = await import('@/platform/env/config');

    expect(getEnvClient().VITE_BASE_URL).toBe(
      'https://preview-runtime.example'
    );
  });

  it('falls back to the deployment URL when no branch URL is available', async () => {
    clearBaseUrlEnvironment();
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_URL', 'preview-deployment.example');

    const { getEnvClient } = await import('@/platform/env/config');

    expect(getEnvClient().VITE_BASE_URL).toBe(
      'https://preview-deployment.example'
    );
  });
});
