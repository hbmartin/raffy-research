import * as Sentry from '@sentry/tanstackstart-react';
import { describe, expect, it } from 'vitest';

describe('Sentry error-only integration set', () => {
  it('does not include automatic performance integrations', () => {
    const errorIntegrationNames = new Set(
      Sentry.getDefaultIntegrationsWithoutPerformance().map(
        (integration) => integration.name
      )
    );
    const overlap = Sentry.getAutoPerformanceIntegrations()
      .map((integration) => integration.name)
      .filter((name) => errorIntegrationNames.has(name));

    expect(overlap).toEqual([]);
  });
});
