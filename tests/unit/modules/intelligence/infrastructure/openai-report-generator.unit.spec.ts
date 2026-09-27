import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

vi.mock('ai', () => ({ generateText: mocks.generateText }));
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
