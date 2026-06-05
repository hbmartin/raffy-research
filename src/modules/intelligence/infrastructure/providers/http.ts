import { Result } from '@swan-io/boxed';

import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { JsonValue } from '@/modules/kernel/domain/json';

/** Perform a JSON HTTP request, mapping failures to AppError. */
export async function fetchJson(
  provider: string,
  url: string,
  init?: RequestInit
): Promise<Result<JsonValue, AppError>> {
  try {
    const response = await fetch(url, init);
    if (!response.ok) {
      return Result.Error(
        new AppError({
          code: 'PROVIDER_HTTP_ERROR',
          category: 'system',
          status: 502,
          message: `${provider} request failed with status ${response.status}`,
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
        cause: error,
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
  try {
    const response = await fetch(url, init);
    if (!response.ok) {
      return Result.Error(
        new AppError({
          code: 'PROVIDER_HTTP_ERROR',
          category: 'system',
          status: 502,
          message: `${provider} request failed with status ${response.status}`,
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
        cause: error,
      })
    );
  }
}
