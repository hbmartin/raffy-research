import { describe, expect, it } from 'vitest';

import { PROVIDER_NAMES } from '@/modules/intelligence';
import { createProviderRegistry } from '@/modules/intelligence/testing';
import { toProviderConfigId, toWorkspaceId } from '@/modules/kernel';

describe('provider registry', () => {
  const registry = createProviderRegistry();

  it('registers an adapter for every supported provider', () => {
    expect(registry.all()).toHaveLength(PROVIDER_NAMES.length);
    for (const name of PROVIDER_NAMES) {
      expect(registry.get(name)?.name).toBe(name);
    }
  });

  it('returns undefined for an unknown provider', () => {
    expect(registry.get('not-a-provider')).toBeUndefined();
  });

  it('skips API providers without a credential', () => {
    const exa = registry.get('exa');
    expect(exa?.isConfigured({ config: null, credential: undefined })).toBe(
      false
    );
    expect(exa?.isConfigured({ config: null, credential: 'key' })).toBe(true);
  });

  it('treats webpage-monitor callbacks as configured when enabled', () => {
    const visualping = registry.get('visualping');
    expect(
      visualping?.isConfigured({ config: null, credential: undefined })
    ).toBe(false);
    expect(
      visualping?.isConfigured({
        config: {
          id: toProviderConfigId('visualping-config'),
          workspaceId: toWorkspaceId('workspace-1'),
          providerName: 'visualping',
          enabled: true,
          credentialsRef: null,
          config: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        credential: undefined,
      })
    ).toBe(true);
  });
});
