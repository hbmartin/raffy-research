import { Result } from '@swan-io/boxed';
import { describe, expect, it, vi } from 'vitest';

import {
  createLocalAiStreamHandler,
  type LocalAiStreamHandlerDeps,
} from '@/modules/intelligence/transport/http/local-ai-stream-handler';

const config = {
  provider: 'ollama',
  model: 'qwen3:14b',
  rawOutputDir: '.local-ai-runs',
  timeoutMs: 600_000,
  ollamaBaseUrl: 'http://localhost:11434/api',
  ollamaNumCtx: undefined,
} as const;

/**
 * Authenticated, authorised, and stopped right after model resolution: the
 * first dependency a run touches is the repositories, so reaching it means the
 * request was accepted.
 */
const handlerWithAcceptedAuth = () => {
  const accepted = vi.fn(() => {
    throw new Error('request accepted');
  });
  const deps = {
    isDev: () => true,
    getConfig: () => config,
    getAuthUseCases: () => ({
      getCurrentSession: async () =>
        Result.Ok({
          type: 'auth_session_found',
          session: { user: { id: 'user-1' } },
        }),
    }),
    getIntelligenceUseCases: () => ({
      getWorkspaceConfig: async () =>
        Result.Ok({ type: 'workspace_config_found' }),
    }),
    getRepositories: accepted,
    buildIngestionDeps: accepted,
    buildGenerationDeps: accepted,
    generateLocalText: accepted,
  } as unknown as LocalAiStreamHandlerDeps;
  return createLocalAiStreamHandler(deps);
};

const request = (body: Record<string, unknown>) =>
  new Request('http://localhost:3000/api/dev/intelligence/local-ai/stream', {
    method: 'POST',
    body: JSON.stringify({
      action: 'list_sources',
      workspaceId: 'x27hidcxs7envs8nsjsv1r7j',
      ...body,
    }),
  });

describe('local AI model resolution', () => {
  it('requires a model when the provider differs from the configured one', async () => {
    const response = await handlerWithAcceptedAuth()(
      request({ provider: 'claude-code' })
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: string;
      message: string;
    };
    expect(body.error).toBe('model_required');
    expect(body.message).toContain('claude-code');
    expect(body.message).toContain('qwen3:14b');
  });

  it('accepts a different provider when a model is given', async () => {
    const response = await handlerWithAcceptedAuth()(
      request({ provider: 'claude-code', model: 'claude-opus-5-5' })
    );

    expect(response.status).toBe(200);
  });

  it.each([{}, { provider: 'ollama' }])(
    'falls back to the configured model for the configured provider (%o)',
    async (body) => {
      const response = await handlerWithAcceptedAuth()(request(body));

      expect(response.status).toBe(200);
    }
  );
});
