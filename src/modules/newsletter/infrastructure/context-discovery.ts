import { Result } from '@swan-io/boxed';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { AppError } from '@/modules/kernel/domain/errors/app-error';
import { readRuntimeEnv } from '@/platform/env/runtime-env';

import type { Runtime } from '../domain/newsletter';
export function createContextDiscovery(input: { ollamaBaseUrl: () => string }) {
  return async (
    runtime: Runtime
  ): Promise<
    Result<
      { type: 'context_found'; tokens: number } | { type: 'context_unknown' },
      AppError
    >
  > => {
    try {
      let tokens: unknown;
      if (runtime.provider === 'codex-cli') {
        const cachePath = path.join(
          typeof readRuntimeEnv().CODEX_HOME === 'string'
            ? (readRuntimeEnv().CODEX_HOME as string)
            : path.join(homedir(), '.codex'),
          'models_cache.json'
        );
        const cache = JSON.parse(await readFile(cachePath, 'utf8')) as {
          models?: { slug?: string; context_window?: number }[];
        };
        tokens = cache.models?.find(
          (model) => model.slug === runtime.model
        )?.context_window;
      } else if (runtime.provider === 'ollama') {
        const response = await fetch(
          `${input.ollamaBaseUrl().replace(/\/$/, '')}/show`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: runtime.model }),
            signal: AbortSignal.timeout(3000),
          }
        );
        if (!response.ok) return Result.Ok({ type: 'context_unknown' });
        const data = (await response.json()) as {
          model_info?: Record<string, unknown>;
        };
        tokens = Object.entries(data.model_info ?? {}).find(([key]) =>
          key.endsWith('.context_length')
        )?.[1];
      }
      return Result.Ok(
        typeof tokens === 'number' &&
          Number.isInteger(tokens) &&
          tokens >= 8192 &&
          tokens <= 2_000_000
          ? { type: 'context_found', tokens }
          : { type: 'context_unknown' }
      );
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')
        return Result.Ok({ type: 'context_unknown' });
      return Result.Error(
        new AppError({
          code: 'NEWSLETTER_CONTEXT_DISCOVERY_FAILED',
          category: 'system',
          status: 503,
          message:
            'Context discovery failed; declare the model context window explicitly',
          cause,
        })
      );
    }
  };
}
