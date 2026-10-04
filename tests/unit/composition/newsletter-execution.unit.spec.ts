import { Result } from '@swan-io/boxed';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NewsletterModel } from '@/modules/newsletter';

const fixture = vi.hoisted(() => ({
  runNext: vi.fn(),
  captured: undefined as { model: NewsletterModel } | undefined,
  generateLocalText: vi.fn(),
  operatorCeiling: 32000,
}));
vi.mock('@/platform/env/client', () => ({ envClient: { DEV: true } }));
vi.mock('@/composition/kernel', () => ({
  getKernel: () => ({
    db: {},
    clock: { now: () => new Date() },
    idGenerator: {},
    logger: { info: vi.fn(), warn: vi.fn() },
    permissionChecker: {
      hasPermission: async () => Result.Ok({ type: 'permission_granted' }),
    },
  }),
}));
vi.mock('@/modules/intelligence/backend', () => ({
  createPublicResearchArchive: () => ({}),
  createIntelligenceRuntimeConfig: () => ({}),
  getLocalAiConfig: () => ({ ollamaNumCtx: fixture.operatorCeiling }),
  generateLocalText: fixture.generateLocalText,
}));
vi.mock('@/modules/newsletter', () => ({
  createNewsletterWorker: (input: { model: NewsletterModel }) => {
    fixture.captured = input;
    return { runNext: fixture.runNext };
  },
  createNewsletterUseCases: () => ({}),
}));
vi.mock('@/modules/newsletter/backend', () => ({
  createHostedNewsletterModel: () => ({ generate: vi.fn() }),
  createContextDiscovery: () => vi.fn(),
  createNewsletterRepository: () => ({
    pendingPublications: async () => Result.Ok([]),
  }),
}));

beforeEach(() => {
  vi.resetModules();
  fixture.runNext.mockReset();
  fixture.generateLocalText.mockReset();
  vi.stubEnv('LOCAL_AI_OPERATOR_USER_ID', 'reader');
  vi.stubEnv('NEWSLETTER_INVOCATION_SECONDS', '800');
  vi.stubEnv('NEWSLETTER_HOSTED_TIMEOUT_MS', '600000');
  vi.stubEnv('NEWSLETTER_LOCAL_WORK_SECONDS', '900');
  vi.stubEnv('LOCAL_AI_TIMEOUT_MS', '600000');
  vi.stubEnv('NEWSLETTER_WORKERS_PAUSED', 'false');
});
describe('Newsletter drain and execution policies', () => {
  it.each([
    { mode: 'hosted' as const, seconds: 640 },
    { mode: 'local' as const, seconds: 900 },
  ])(
    'stops $mode draining after an admission yield with its independent deadline',
    async ({ mode, seconds }) => {
      fixture.runNext.mockResolvedValue(
        Result.Ok({
          type: 'job_finished',
          status: 'queued',
          jobId: 'fixture',
          yieldReason: 'invocation_budget',
        })
      );
      const start = Date.now();
      const { drainNewsletterQueue } = await import('@/composition/newsletter');
      expect(await drainNewsletterQueue(mode)).toEqual({
        status: 'processed',
        stages: 1,
      });
      expect(fixture.runNext).toHaveBeenCalledTimes(1);
      const deadline = fixture.runNext.mock.calls[0]![1].deadline as Date;
      expect(deadline.getTime() - start).toBeGreaterThanOrEqual(seconds * 1000);
      expect(deadline.getTime() - start).toBeLessThan(seconds * 1000 + 1000);
    }
  );
  it('rejects a pinned Ollama allocation above the actual operator ceiling without dispatch', async () => {
    const { getNewsletterRuntime } = await import('@/composition/newsletter');
    getNewsletterRuntime();
    const result = await fixture.captured!.model.generate({
      runtime: { mode: 'local', provider: 'ollama', model: 'custom' },
      prompt: 'fixture',
      jobId: 'job',
      stage: 'drafting',
      contextBudget: 64000,
      timeoutMs: 600000,
    });
    expect(result.isError()).toBe(true);
    if (result.isError())
      expect(result.getError()).toMatchObject({
        code: 'NEWSLETTER_LOCAL_ALLOCATION',
        details: { pinnedContext: 64000, operatorCeiling: 32000 },
      });
    expect(fixture.generateLocalText).not.toHaveBeenCalled();
  });
});
