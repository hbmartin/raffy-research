import { describe, expect, it } from 'vitest';

import {
  jobGenerationBudget,
  resolveGenerationBudget,
} from '@/modules/newsletter/domain/processing';
import type { NewsletterJob, Runtime } from '@/modules/newsletter/testing';

const hosted: Runtime = {
  mode: 'hosted',
  provider: 'openai',
  model: 'custom',
  contextWindowTokens: 64000,
};
describe('Pinned newsletter generation budgets', () => {
  it('defaults new hosted jobs to 16384 and keeps legacy jobs at 4096', () => {
    expect(resolveGenerationBudget(hosted)).toMatchObject({
      type: 'budget_resolved',
      budget: { outputTokens: 16384, inputBytes: 45568 },
    });
    expect(
      jobGenerationBudget({
        runtime: hosted,
        contextBudget: 64000,
      } as NewsletterJob)
    ).toMatchObject({
      outputTokens: 4096,
      inputBytes: 57856,
      origin: 'legacy',
    });
  });
  it('rejects response caps that leave insufficient prompt capacity', () => {
    expect(
      resolveGenerationBudget({ ...hosted, contextWindowTokens: 8192 })
    ).toMatchObject({ type: 'budget_invalid' });
    expect(
      resolveGenerationBudget({
        ...hosted,
        contextWindowTokens: 8192,
        maxOutputTokens: 4096,
      })
    ).toMatchObject({ type: 'budget_resolved', budget: { inputBytes: 2048 } });
  });
  it('binds discovered context to provider and model and preserves a separate declared ceiling', () => {
    const discovered: Runtime = {
      ...hosted,
      contextWindowTokens: 32000,
      contextLimit: {
        provider: 'openai',
        model: 'custom',
        tokens: 64000,
        origin: 'discovered',
      },
    };
    expect(resolveGenerationBudget(discovered)).toMatchObject({
      budget: { contextTokens: 32000, origin: 'declared' },
    });
    expect(
      resolveGenerationBudget({
        ...discovered,
        model: 'different-custom',
        contextWindowTokens: undefined,
      })
    ).toEqual({ type: 'context_required' });
    expect(
      resolveGenerationBudget(
        {
          ...discovered,
          provider: 'ollama',
          mode: 'local',
          contextWindowTokens: undefined,
        },
        64000
      )
    ).toEqual({ type: 'context_required' });
  });
  it('requires an Ollama allocation and resolves the minimum of all three limits', () => {
    const runtime: Runtime = {
      mode: 'local',
      provider: 'ollama',
      model: 'custom',
      contextWindowTokens: 48000,
      contextLimit: {
        provider: 'ollama',
        model: 'custom',
        tokens: 64000,
        origin: 'discovered',
      },
    };
    expect(resolveGenerationBudget(runtime)).toEqual({
      type: 'local_allocation_required',
    });
    expect(resolveGenerationBudget(runtime, 32000)).toMatchObject({
      budget: { contextTokens: 32000, operatorCeiling: 32000 },
    });
    expect(resolveGenerationBudget(runtime, 100000)).toMatchObject({
      budget: { contextTokens: 48000 },
    });
  });
});
