import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPhoenixClient } from '../../../scripts/eval/phoenix-client';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock('@/modules/intelligence/backend', () => ({
  getPhoenixConfig: () => ({
    enabled: true,
    appUrl: 'https://phoenix.example/s/workspace',
    apiKey: 'test-key',
  }),
}));
vi.mock('../../../scripts/eval/telemetry', () => ({
  getEvalTelemetryConfig: () => ({ projectName: 'start-ui-web-evals' }),
}));
vi.mock('@arizeai/phoenix-client', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@arizeai/phoenix-client')>();
  return {
    ...actual,
    createClient: (config: Parameters<typeof actual.createClient>[0]) =>
      actual.createClient({
        ...config,
        options: { ...config?.options, fetch: mocks.fetch },
      }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockImplementation(async () =>
    Response.json({
      data: { id: 'experiment-1', project_name: 'start-ui-web-evals' },
    })
  );
});

describe('Phoenix eval client', () => {
  it('sends experiments to the existing project while preserving auth, space, and metadata', async () => {
    const client = await createPhoenixClient();
    await client.POST('/v1/datasets/{dataset_id}/experiments', {
      params: { path: { dataset_id: 'dataset-1' } },
      body: {
        name: 'comparison',
        project_name: 'sdk-generated-project',
        repetitions: 1,
        metadata: { environment: 'local', model: 'test-model' },
      },
    });

    const request = mocks.fetch.mock.calls[0]![0] as Request;
    expect(request.url).toBe(
      'https://phoenix.example/s/workspace/v1/datasets/dataset-1/experiments'
    );
    expect(request.headers.get('authorization')).toBe('Bearer test-key');
    expect(await request.json()).toEqual({
      name: 'comparison',
      project_name: 'start-ui-web-evals',
      repetitions: 1,
      metadata: { environment: 'local', model: 'test-model' },
    });
  });

  it('leaves project reads untouched', async () => {
    const client = await createPhoenixClient();
    await client.GET('/v1/projects');
    const request = mocks.fetch.mock.calls[0]![0] as Request;
    expect(request.method).toBe('GET');
    expect(request.body).toBeNull();
    expect(request.url).toBe('https://phoenix.example/s/workspace/v1/projects');
  });
});
