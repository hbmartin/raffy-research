import { describe, expect, it, vi } from 'vitest';

import { AppError } from '@/modules/kernel/domain/errors/app-error';
import { createHostedNewsletterModel } from '@/modules/newsletter/backend';

const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock('ai', () => ({ generateText }));
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => (model: string) => model,
}));
describe('Hosted newsletter termination metadata', () => {
  it('returns a capacity error for length termination with usage and partial text', async () => {
    generateText.mockResolvedValueOnce({
      text: 'partial JSON',
      finishReason: 'length',
      usage: { outputTokens: 16384 },
    });
    const result = await createHostedNewsletterModel({
      apiKey: () => 'fixture',
    }).generate({
      runtime: { mode: 'hosted', provider: 'openai', model: 'custom' },
      prompt: 'fixture',
      stage: 'drafting',
      jobId: 'job',
      maxOutputTokens: 16384,
    });
    expect(result.isError()).toBe(true);
    if (result.isOk()) throw new Error('Expected model failure');
    expect(result.getError()).toMatchObject({
      code: 'NEWSLETTER_OUTPUT_LIMIT',
      details: {
        partialText: 'partial JSON',
        maxOutputTokens: 16384,
        usage: { outputTokens: 16384 },
      },
    });
    expect(generateText).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxOutputTokens: 16384, maxRetries: 0 })
    );
  });
  it('preserves lease-loss cancellation instead of wrapping it as a provider failure', async () => {
    const controller = new AbortController();
    const lease = new AppError({
      code: 'NEWSLETTER_LEASE_LOST',
      category: 'system',
      status: 409,
      message: 'Lost',
    });
    controller.abort(lease);
    generateText.mockRejectedValueOnce(new Error('AbortError'));
    const result = await createHostedNewsletterModel({
      apiKey: () => 'fixture',
    }).generate({
      runtime: { mode: 'hosted', provider: 'openai', model: 'custom' },
      prompt: '',
      jobId: 'job',
      stage: 'audit',
      signal: controller.signal,
    });
    if (result.isOk()) throw new Error('Expected model failure');
    expect(result.getError()).toBe(lease);
  });
});
