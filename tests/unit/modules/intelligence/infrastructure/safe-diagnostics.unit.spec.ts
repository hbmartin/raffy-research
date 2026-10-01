import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  safeAppErrorDetails,
  safeFailureDiagnostics,
} from '@/modules/intelligence/application/safe-diagnostics';
import { fetchJson } from '@/modules/intelligence/infrastructure/providers/http';
import { AppError } from '@/modules/kernel/domain/errors/app-error';

const fakeSecret = 'sk-secret-fake-123';

afterEach(() => vi.unstubAllGlobals());

describe('safe provider diagnostics', () => {
  it.each([401, 429])(
    'keeps status and request ID for HTTP %i without exposing the response',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(fakeSecret, {
              status,
              headers: { 'x-request-id': 'req_abc123' },
            })
        )
      );
      const result = await fetchJson(
        'exa',
        `https://example.com/?key=${fakeSecret}`
      );
      expect(result.isError()).toBe(true);
      const serialized = JSON.stringify(
        result.isError()
          ? {
              message: result.getError().message,
              details: result.getError().details,
            }
          : result.get()
      );
      expect(serialized).toContain(`"upstreamStatus":${status}`);
      expect(serialized).toContain('req_abc123');
      expect(serialized).not.toContain(fakeSecret);
      expect(serialized).not.toContain('example.com');
    }
  );

  it('discards raw timeout messages and embedded secrets', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new Error(`timeout ${fakeSecret}`), {
          name: 'TimeoutError',
          code: fakeSecret,
        });
      })
    );
    const result = await fetchJson('exa', 'https://example.com/');
    if (result.isOk()) throw new Error('Expected provider failure');
    const error = result.getError();
    expect(
      JSON.stringify({ message: error.message, details: error.details })
    ).not.toContain(fakeSecret);
    expect(error.details).toMatchObject({
      provider: 'exa',
      stage: 'http',
      errorType: 'TimeoutError',
    });
    expect(error.cause).toBeUndefined();
  });

  it('rejects token-shaped diagnostic values', () => {
    expect(
      safeFailureDiagnostics({
        error: { code: fakeSecret, requestID: fakeSecret, status: 429 },
        provider: 'openai',
        stage: 'repair',
        durationMs: 9,
      })
    ).toEqual({
      provider: 'openai',
      stage: 'repair',
      upstreamStatus: 429,
      durationMs: 9,
    });
  });

  it('filters details again before forwarding an application error', () => {
    const error = new AppError({
      code: 'PROVIDER_HTTP_ERROR',
      category: 'system',
      status: 502,
      message: 'Provider request failed',
      details: {
        provider: 'exa',
        errorCode: fakeSecret,
        requestId: 'req_abc123',
        rawBody: fakeSecret,
        durationMs: Number.NaN,
      },
    });
    expect(safeAppErrorDetails(error)).toEqual({
      provider: 'exa',
      requestId: 'req_abc123',
    });
  });
});

it.each(['token_revoked', 'token_expired'])(
  'retains harmless provider code %s',
  (code) => {
    const details = safeFailureDiagnostics({
      error: { code },
      provider: 'slack',
      stage: 'http',
      durationMs: 1,
    });
    expect(details.errorCode).toBe(code);
    expect(
      safeAppErrorDetails(
        new AppError({
          code: 'PROVIDER_ERROR',
          category: 'system',
          status: 502,
          details,
        })
      ).errorCode
    ).toBe(code);
  }
);
