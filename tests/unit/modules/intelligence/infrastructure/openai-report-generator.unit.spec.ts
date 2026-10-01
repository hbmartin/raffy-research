import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: mocks.generateText,
}));
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: () => () => ({}) }));
vi.mock('@/modules/intelligence/infrastructure/config/runtime', () => ({
  getOpenAiConfig: () => ({ apiKey: 'sk-secret-fake-123', model: 'gpt-4.1' }),
}));

import { createOpenAiReportGenerator } from '@/modules/intelligence/backend';

describe('OpenAI report diagnostics', () => {
  it.each([
    { stage: 'initial' as const, status: 401, code: 'invalid_api_key' },
    { stage: 'initial' as const, status: 429, code: 'rate_limit_exceeded' },
    { stage: 'repair' as const, status: undefined, code: 'ETIMEDOUT' },
  ])(
    'keeps safe $stage failure details for $code',
    async ({ stage, status, code }) => {
      const fakeSecret = 'sk-secret-fake-123';
      mocks.generateText.mockRejectedValueOnce(
        Object.assign(new Error(`prompt ${fakeSecret}`), {
          name: 'APIError',
          code,
          status,
          requestID: 'req_abc123',
        })
      );
      const result = await createOpenAiReportGenerator().generate({
        prompt: `prompt ${fakeSecret}`,
        stage,
      });
      if (result.isOk()) throw new Error('Expected a failed generation');
      const error = result.getError();
      expect(error.message).toBe('OpenAI report generation failed');
      expect(error.details).toMatchObject({
        stage,
        provider: 'openai',
        model: 'gpt-4.1',
        errorCode: code,
        requestId: 'req_abc123',
      });
      if (status)
        expect(error.details).toMatchObject({ upstreamStatus: status });
      expect(
        JSON.stringify({ message: error.message, details: error.details })
      ).not.toContain(fakeSecret);
      expect(error.cause).toBeUndefined();
    }
  );
});

it.each([401, 429])(
  'extracts real AI SDK HTTP %i diagnostics',
  async (statusCode) => {
    const { APICallError, RetryError } = await import('ai');
    const apiError = new APICallError({
      message: 'raw sk-secret-fake-123',
      url: 'https://example.com/private',
      requestBodyValues: { prompt: 'private' },
      statusCode,
      responseHeaders: { 'x-request-id': 'req_real123' },
      responseBody: 'sk-secret-fake-123',
    });
    const error =
      statusCode === 429
        ? new RetryError({
            message: 'retry failed',
            reason: 'maxRetriesExceeded',
            errors: [apiError],
          })
        : apiError;
    mocks.generateText.mockRejectedValueOnce(error);
    const result = await createOpenAiReportGenerator().generate({
      prompt: 'private',
    });
    if (result.isOk()) throw new Error('Expected failure');
    expect(result.getError().details).toMatchObject({
      upstreamStatus: statusCode,
      requestId: 'req_real123',
      errorType: 'AI_APICallError',
    });
    expect(JSON.stringify(result.getError())).not.toMatch(
      /private|sk-secret-fake-123/
    );
  }
);

it('bounds error unwrapping and terminates cyclic causes', async () => {
  const cyclic = new Error('raw secret');
  cyclic.cause = cyclic;
  mocks.generateText.mockRejectedValueOnce(cyclic);
  const result = await createOpenAiReportGenerator().generate({
    prompt: 'private',
  });
  expect(result.isError()).toBe(true);
});
