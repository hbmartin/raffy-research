import { describe, expect, it } from 'vitest';

import {
  defaultModelFor,
  LOCAL_AI_MODEL_SUGGESTIONS,
  LOCAL_AI_PROVIDERS,
} from '@/modules/intelligence';

describe('local AI model suggestions', () => {
  /**
   * Picking a provider pre-fills its first suggestion. A provider without one
   * would fall back to a blank model, which the server rejects whenever that
   * provider is not the configured one.
   */
  it.each(LOCAL_AI_PROVIDERS)('suggests at least one model for %s', (p) => {
    expect(LOCAL_AI_MODEL_SUGGESTIONS[p].length).toBeGreaterThan(0);
    expect(defaultModelFor(p)).toBe(LOCAL_AI_MODEL_SUGGESTIONS[p][0]);
  });

  /** The bug this list exists to prevent: one provider's model sent to another. */
  it('never suggests the same model for two providers', () => {
    const all = LOCAL_AI_PROVIDERS.flatMap(
      (p) => LOCAL_AI_MODEL_SUGGESTIONS[p]
    );

    expect(new Set(all).size).toBe(all.length);
  });
});
