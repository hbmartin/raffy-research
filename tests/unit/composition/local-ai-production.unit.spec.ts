import { afterEach, expect, it, vi } from 'vitest';

import {
  createLocalAiStreamHandler,
  type LocalAiStreamHandlerDeps,
} from '@/modules/intelligence/transport/http/local-ai-stream-handler';
import {
  isDevelopmentEnv,
  mergeRuntimeEnv,
} from '@/platform/env/merge-runtime-env';

const sources = vi.hoisted(() => ({
  runtime: {} as Record<string, unknown>,
  build: { DEV: false, PROD: true, VITE_BASE_URL: 'https://built.example' },
}));
vi.mock('@/platform/env/runtime-env', async () => {
  const { mergeRuntimeEnv } = await import('@/platform/env/merge-runtime-env');
  return {
    readRuntimeEnv: () => mergeRuntimeEnv(sources.runtime, sources.build),
  };
});
afterEach(() => vi.resetModules());

it.each([undefined, 'development', 'production'])(
  'rejects local AI before authentication or providers when NODE_ENV=%s',
  async (NODE_ENV) => {
    sources.runtime = { NODE_ENV, VITE_BASE_URL: 'https://runtime.example' };
    const { getEnvClient } = await import('@/platform/env/config');
    const forbidden = vi.fn(() => {
      throw new Error('Must not access private services');
    });
    const deps = new Proxy(
      { isDev: () => getEnvClient().DEV },
      {
        get(target, key) {
          return key === 'isDev' ? target.isDev : forbidden;
        },
      }
    ) as LocalAiStreamHandlerDeps;
    const response = await createLocalAiStreamHandler(deps)(
      new Request(
        'https://built.example/api/dev/intelligence/local-ai/stream',
        { method: 'POST', body: 'invalid json' }
      )
    );
    expect(response.status).toBe(404);
    expect(forbidden).not.toHaveBeenCalled();
    expect(getEnvClient().VITE_BASE_URL).toBe('https://built.example');
    expect(
      isDevelopmentEnv(mergeRuntimeEnv(sources.runtime, sources.build))
    ).toBe(false);
  }
);
