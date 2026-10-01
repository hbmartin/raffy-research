import { Result } from '@swan-io/boxed';

import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { JsonValue } from '@/modules/kernel/domain/json';

import { safeFailureDiagnostics } from '../../application/safe-diagnostics';

const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;

function withDefaultTimeout(init?: RequestInit): RequestInit | undefined {
  if (init?.signal || typeof AbortSignal.timeout !== 'function') return init;
  return { ...init, signal: AbortSignal.timeout(DEFAULT_PROVIDER_TIMEOUT_MS) };
}

/** Perform a JSON HTTP request, mapping failures to AppError. */
export async function fetchJson(
  provider: string,
  url: string,
  init?: RequestInit
): Promise<Result<JsonValue, AppError>> {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, withDefaultTimeout(init));
    if (!response.ok) {
      return Result.Error(
        new AppError({
          code: 'PROVIDER_HTTP_ERROR',
          category: 'system',
          status: 502,
          message: `${provider} request failed`,
          details: safeFailureDiagnostics({
            error: null,
            stage: 'http',
            provider,
            upstreamStatus: response.status,
            requestId: response.headers.get('x-request-id'),
            durationMs: Date.now() - startedAt,
          }),
        })
      );
    }
    const json = (await response.json()) as JsonValue;
    return Result.Ok(json);
  } catch (error) {
    return Result.Error(
      new AppError({
        code: 'PROVIDER_HTTP_ERROR',
        category: 'system',
        status: 502,
        message: `${provider} request failed`,
        details: safeFailureDiagnostics({
          error,
          stage: 'http',
          provider,
          durationMs: Date.now() - startedAt,
        }),
      })
    );
  }
}

/** Perform an HTTP request returning the raw response body as text. */
export async function fetchText(
  provider: string,
  url: string,
  init?: RequestInit
): Promise<Result<string, AppError>> {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, withDefaultTimeout(init));
    if (!response.ok) {
      return Result.Error(
        new AppError({
          code: 'PROVIDER_HTTP_ERROR',
          category: 'system',
          status: 502,
          message: `${provider} request failed`,
          details: safeFailureDiagnostics({
            error: null,
            stage: 'http',
            provider,
            upstreamStatus: response.status,
            requestId: response.headers.get('x-request-id'),
            durationMs: Date.now() - startedAt,
          }),
        })
      );
    }
    return Result.Ok(await response.text());
  } catch (error) {
    return Result.Error(
      new AppError({
        code: 'PROVIDER_HTTP_ERROR',
        category: 'system',
        status: 502,
        message: `${provider} request failed`,
        details: safeFailureDiagnostics({
          error,
          stage: 'http',
          provider,
          durationMs: Date.now() - startedAt,
        }),
      })
    );
  }
}
