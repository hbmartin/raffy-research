import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getEvalTelemetryConfig } from '../../../scripts/eval/telemetry';

const config = vi.hoisted(() => ({
  serviceName: 'raffy-research-local',
  otelEnvironment: 'local',
  phoenixProjectName: 'start-ui-web-local',
  phoenixEvalProjectName: 'start-ui-web-evals',
}));

vi.mock('@/modules/kernel/infrastructure/config/telemetry', () => ({
  getTelemetryConfig: () => config,
}));

beforeEach(() => {
  config.otelEnvironment = 'local';
});

describe('eval experiment telemetry', () => {
  it('groups SDK experiment spans with model spans rather than the app project', () => {
    expect(getEvalTelemetryConfig()).toEqual({
      projectName: 'start-ui-web-evals',
      experimentMetadata: { environment: 'local', role: 'evals' },
    });
  });

  it('records the executing environment independently of the eval project', () => {
    config.otelEnvironment = 'production';
    expect(getEvalTelemetryConfig()).toEqual({
      projectName: 'start-ui-web-evals',
      experimentMetadata: { environment: 'production', role: 'evals' },
    });
  });
});
