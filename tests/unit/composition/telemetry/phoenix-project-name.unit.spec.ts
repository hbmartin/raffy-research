import { describe, expect, it } from 'vitest';

import { resolvePhoenixProjectName } from '@/composition/telemetry/otel.server';

type Config = Parameters<typeof resolvePhoenixProjectName>[0];

const config = (over: Partial<Config> = {}) =>
  ({
    serviceName: 'start-ui-web',
    otelEnvironment: 'local',
    ...over,
  }) as Config;

/**
 * Phoenix files every span under `default` unless the resource names a
 * project, which put production traffic, local runs and eval experiments in
 * one pile distinguishable only by timestamp. These names are derived rather
 * than configured so the split survives nobody remembering to set it.
 */
describe('resolvePhoenixProjectName', () => {
  it('separates the app by environment', () => {
    expect(
      resolvePhoenixProjectName(config({ otelEnvironment: 'production' }))
    ).toBe('start-ui-web-production');
    expect(
      resolvePhoenixProjectName(config({ otelEnvironment: 'local' }))
    ).toBe('start-ui-web-local');
  });

  it('gives a non-application role its own project, whatever the environment', () => {
    const name = resolvePhoenixProjectName(config(), 'evals');
    expect(name).toBe('start-ui-web-evals');
    // An eval run on a production machine is still an experiment.
    expect(
      resolvePhoenixProjectName(
        config({ otelEnvironment: 'production' }),
        'evals'
      )
    ).toBe(name);
  });

  it('lets PHOENIX_PROJECT_NAME pin everything to one project', () => {
    const pinned = config({ phoenixProjectName: 'one-bucket' });
    expect(resolvePhoenixProjectName(pinned)).toBe('one-bucket');
    expect(resolvePhoenixProjectName(pinned, 'evals')).toBe('one-bucket');
  });

  it('omits the suffix rather than trailing a dash when no environment is set', () => {
    expect(
      resolvePhoenixProjectName(config({ otelEnvironment: undefined }))
    ).toBe('start-ui-web');
  });
});
