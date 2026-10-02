import { Result } from '@swan-io/boxed';
import { describe, expect, it, vi } from 'vitest';

import {
  handleProviderCallback,
  type HandleProviderCallbackOutcome,
  type IngestionDeps,
  type IngestionRun,
  type LastSuccessfulRunOutcome,
  type ProviderCallbackEvent,
  type ProviderDailyContext,
  resolveIngestWindowStart,
  runWorkspaceIngest,
  type RunWorkspaceIngestOutcome,
  type SourceRecord,
  type Workspace,
} from '@/modules/intelligence';
import type { Logger } from '@/modules/kernel/application/ports/logger';
import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import {
  toIngestionRunId,
  toProviderCallbackEventId,
  toProviderConfigId,
  toSourceRecordId,
  toWorkspaceId,
} from '@/modules/kernel/domain/ids';

const now = new Date('2026-06-01T00:00:00.000Z');
const workspaceId = toWorkspaceId('ws-1');

const workspace: Workspace = {
  id: workspaceId,
  name: 'Acme',
  companyName: 'Acme Dental',
  companyDescription: 'Recall automation for clinics',
  subcategory: 'Dental SaaS',
  timezone: 'America/Los_Angeles',
  website: null,
  positioning: null,
  icp: null,
  marketAssumptions: null,
  gtmFocus: null,
  createdAt: now,
  updatedAt: now,
};

const callbackEvent = {
  id: toProviderCallbackEventId('callback-1'),
  workspaceId,
  providerName: 'awario',
  rawPayload: {},
  normalizationStatus: 'pending',
  normalizationError: null,
  sourceRecordId: null,
  receivedAt: now,
  createdAt: now,
} satisfies ProviderCallbackEvent;

const sourceRecord = {
  id: toSourceRecordId('source-1'),
  workspaceId,
  providerName: 'awario',
  providerSourceId: null,
  sourceType: 'mention',
  sourceSubtype: null,
  sourceName: null,
  sourceUrl: null,
  externalUrl: null,
  title: 'Mention',
  authorOrAccount: null,
  domain: null,
  publishedAt: null,
  capturedAt: now,
  contentText: 'content',
  diffAddedText: null,
  diffRemovedText: null,
  rawPayload: {},
  metadata: null,
  relevanceLabel: null,
  labeledAt: null,
  createdAt: now,
  updatedAt: now,
} satisfies SourceRecord;

const ingestionRun: IngestionRun = {
  id: toIngestionRunId('run-1'),
  workspaceId,
  providerName: 'awario',
  runType: 'daily',
  status: 'started',
  startedAt: now,
  finishedAt: null,
  itemsIngested: 0,
  failureReason: null,
  metadata: null,
  createdAt: now,
};

const makeLogger = (): Logger => ({
  debug: vi.fn<Logger['debug']>(),
  info: vi.fn<Logger['info']>(),
  warn: vi.fn<Logger['warn']>(),
  error: vi.fn<Logger['error']>(),
});

const appError = (code: string) =>
  new AppError({
    code,
    category: 'system',
    status: 500,
  });

function expectErrorCode(
  result: ApplicationResult<
    HandleProviderCallbackOutcome | RunWorkspaceIngestOutcome
  >,
  code: string
) {
  if (result.isOk()) throw new Error(`Expected ${code}, got success`);
  expect(result.getError().code).toBe(code);
}

function makeDeps(overrides: Partial<IngestionDeps> = {}): IngestionDeps {
  const deps = {
    workspaceRepository: {
      getById: vi.fn(async () =>
        Result.Ok({ type: 'workspace_found' as const, workspace })
      ),
      listKeywords: vi.fn(async () => Result.Ok([])),
      listCompetitors: vi.fn(async () => Result.Ok([])),
      listSocialAccounts: vi.fn(async () => Result.Ok([])),
      listInternalNoteConfigs: vi.fn(async () => Result.Ok([])),
      getProviderConfig: vi.fn(async () =>
        Result.Ok({ type: 'provider_config_not_found' as const })
      ),
      listProviderConfigs: vi.fn(async () =>
        Result.Ok([
          {
            id: toProviderConfigId('provider-1'),
            workspaceId,
            providerName: 'awario' as const,
            enabled: true,
            credentialsRef: null,
            config: null,
            createdAt: now,
            updatedAt: now,
          },
        ])
      ),
    },
    sourceRepository: {
      createSourceRecord: vi.fn(async () => {
        throw new Error('not expected');
      }),
      createSearchResult: vi.fn(async () => {
        throw new Error('not expected');
      }),
      createCallbackArtifacts: vi.fn(async () =>
        Result.Ok({ sourceRecords: [], searchResults: [] })
      ),
    },
    ingestionRepository: {
      startRun: vi.fn(async () => Result.Ok(ingestionRun)),
      finishRun: vi.fn(async () => Result.Ok({ type: 'run_updated' as const })),
      getLastSuccessfulDailyRun: vi.fn(async () =>
        Result.Ok({ type: 'no_previous_run' as const })
      ),
      recordCallbackEvent: vi.fn(async () => Result.Ok(callbackEvent)),
      updateCallbackNormalization: vi.fn(async () =>
        Result.Ok({ type: 'callback_updated' as const })
      ),
    },
    registry: {
      get: vi.fn(() => undefined),
      all: vi.fn(() => []),
    },
    credentialResolver: { resolve: vi.fn(() => undefined) },
    clock: { now: vi.fn(() => now) },
    logger: makeLogger(),
  } as unknown as IngestionDeps;

  return { ...deps, ...overrides };
}

describe('ingestion use cases', () => {
  it('returns callback normalization update errors', async () => {
    const deps = makeDeps({
      ingestionRepository: {
        ...makeDeps().ingestionRepository,
        updateCallbackNormalization: vi.fn(async () =>
          Result.Error(appError('CALLBACK_UPDATE_FAILED'))
        ),
      },
    });

    const result = await handleProviderCallback(deps, {
      providerName: 'unknown',
      workspaceId,
      payload: {},
    });

    expectErrorCode(result, 'CALLBACK_UPDATE_FAILED');
  });

  it('marks callback normalization failed when adapter normalization fails', async () => {
    const updateCallbackNormalization = vi.fn(async () =>
      Result.Ok({ type: 'callback_updated' as const })
    );
    const error = appError('NORMALIZATION_FAILED');
    const deps = makeDeps({
      ingestionRepository: {
        ...makeDeps().ingestionRepository,
        updateCallbackNormalization,
      },
      registry: {
        get: vi.fn(() => ({
          name: 'awario' as const,
          isConfigured: () => true,
          normalizeCallback: async () => Result.Error(error),
        })),
        all: vi.fn(() => []),
      },
    });

    const result = await handleProviderCallback(deps, {
      providerName: 'awario',
      workspaceId,
      payload: {},
    });

    expectErrorCode(result, 'NORMALIZATION_FAILED');
    expect(updateCallbackNormalization).toHaveBeenCalledWith(callbackEvent.id, {
      normalizationStatus: 'failed',
      normalizationError: error.message,
    });
  });

  it('writes normalized callback artifacts through the atomic repository method', async () => {
    const createCallbackArtifacts = vi.fn(async () =>
      Result.Ok({ sourceRecords: [sourceRecord], searchResults: [] })
    );
    const deps = makeDeps({
      sourceRepository: {
        ...makeDeps().sourceRepository,
        createCallbackArtifacts,
      },
      registry: {
        get: vi.fn(() => ({
          name: 'awario' as const,
          isConfigured: () => true,
          normalizeCallback: async () =>
            Result.Ok({
              type: 'normalized' as const,
              sourceRecords: [
                {
                  workspaceId,
                  providerName: 'awario',
                  sourceType: 'mention',
                  title: 'Mention',
                },
              ],
              searchResults: [],
            }),
        })),
        all: vi.fn(() => []),
      },
    });

    const result = await handleProviderCallback(deps, {
      providerName: 'awario',
      workspaceId,
      payload: {},
    });

    expect(result.isOk()).toBe(true);
    expect(createCallbackArtifacts).toHaveBeenCalledWith({
      sourceRecords: [
        {
          workspaceId,
          providerName: 'awario',
          sourceType: 'mention',
          title: 'Mention',
        },
      ],
      searchResults: [],
    });
  });

  it('marks callback normalization failed when artifact persistence fails', async () => {
    const updateCallbackNormalization = vi.fn(async () =>
      Result.Ok({ type: 'callback_updated' as const })
    );
    const error = appError('CALLBACK_ARTIFACTS_FAILED');
    const deps = makeDeps({
      ingestionRepository: {
        ...makeDeps().ingestionRepository,
        updateCallbackNormalization,
      },
      sourceRepository: {
        ...makeDeps().sourceRepository,
        createCallbackArtifacts: vi.fn(async () => Result.Error(error)),
      },
      registry: {
        get: vi.fn(() => ({
          name: 'awario' as const,
          isConfigured: () => true,
          normalizeCallback: async () =>
            Result.Ok({
              type: 'normalized' as const,
              sourceRecords: [
                {
                  workspaceId,
                  providerName: 'awario',
                  sourceType: 'mention',
                  title: 'Mention',
                },
              ],
            }),
        })),
        all: vi.fn(() => []),
      },
    });

    const result = await handleProviderCallback(deps, {
      providerName: 'awario',
      workspaceId,
      payload: {},
    });

    expectErrorCode(result, 'CALLBACK_ARTIFACTS_FAILED');
    expect(updateCallbackNormalization).toHaveBeenCalledWith(callbackEvent.id, {
      normalizationStatus: 'failed',
      normalizationError: error.message,
    });
  });

  it('returns failed-run finalization errors', async () => {
    const deps = makeDeps({
      ingestionRepository: {
        ...makeDeps().ingestionRepository,
        finishRun: vi.fn(async () =>
          Result.Error(appError('FINISH_RUN_FAILED'))
        ),
      },
      registry: {
        get: vi.fn(() => ({
          name: 'awario' as const,
          isConfigured: () => true,
          runDailyIngest: async () => Result.Error(appError('PROVIDER_FAILED')),
        })),
        all: vi.fn(() => []),
      },
    });

    const result = await runWorkspaceIngest(deps, { workspaceId, now });

    expectErrorCode(result, 'FINISH_RUN_FAILED');
  });

  it.each([
    {
      requestsSucceeded: 1,
      requestsFailed: 1,
      status: 'partial',
      providersPartial: 1,
      providersFailed: 0,
    },
    {
      requestsSucceeded: 0,
      requestsFailed: 2,
      status: 'failed',
      providersPartial: 0,
      providersFailed: 1,
    },
  ])(
    'records $status when pull requests have mixed outcomes',
    async (counts) => {
      const finishRun = vi.fn(async () =>
        Result.Ok({ type: 'run_updated' as const })
      );
      const deps = makeDeps({
        ingestionRepository: { ...makeDeps().ingestionRepository, finishRun },
        registry: {
          get: vi.fn(() => ({
            name: 'awario' as const,
            isConfigured: () => true,
            runDailyIngest: async () =>
              Result.Ok({
                sourceRecords: [],
                searchResults: [],
                requestsSucceeded: counts.requestsSucceeded,
                requestsFailed: counts.requestsFailed,
              }),
          })),
          all: vi.fn(() => []),
        },
      });
      const result = await runWorkspaceIngest(deps, {
        workspaceId,
        now,
        scheduledJobRunId: 'job-1',
      });
      if (result.isError()) throw result.getError();
      expect(result.get()).toMatchObject({
        type: 'workspace_ingested',
        providersPartial: counts.providersPartial,
        providersFailed: counts.providersFailed,
        requestsFailed: counts.requestsFailed,
      });
      expect(finishRun).toHaveBeenCalledWith(
        ingestionRun.id,
        expect.objectContaining({
          status: counts.status,
          failureReason: 'Provider requests failed',
        })
      );
      expect(deps.ingestionRepository.startRun).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduledJobRunId: 'job-1',
        })
      );
    }
  );

  it('keeps the provider summary and stored status aligned after a write fails', async () => {
    const finishRun = vi.fn(async () =>
      Result.Ok({ type: 'run_updated' as const })
    );
    const deps = makeDeps({
      sourceRepository: {
        ...makeDeps().sourceRepository,
        createSourceRecord: vi.fn(async () =>
          Result.Error(appError('SOURCE_WRITE_FAILED'))
        ),
      },
      ingestionRepository: { ...makeDeps().ingestionRepository, finishRun },
      registry: {
        get: vi.fn(() => ({
          name: 'awario' as const,
          isConfigured: () => true,
          runDailyIngest: async () =>
            Result.Ok({
              sourceRecords: [sourceRecord],
              searchResults: [],
              requestsSucceeded: 1,
              requestsFailed: 0,
            }),
        })),
        all: vi.fn(() => []),
      },
    });
    const result = await runWorkspaceIngest(deps, { workspaceId, now });
    if (result.isError()) throw result.getError();
    expect(result.get()).toMatchObject({
      providersPartial: 0,
      providersFailed: 1,
    });
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'intelligence.ingestion.persistence_failed',
        details: expect.objectContaining({
          stage: 'source_record',
          errorCode: 'SOURCE_WRITE_FAILED',
        }),
      })
    );
    expect(finishRun).toHaveBeenCalledWith(
      ingestionRun.id,
      expect.objectContaining({ status: 'failed', itemsIngested: 0 })
    );
  });

  it('treats a workspace with no scheduled pull providers as successful no-work', async () => {
    const result = await runWorkspaceIngest(makeDeps(), { workspaceId, now });
    if (result.isError()) throw result.getError();
    expect(result.get()).toMatchObject({
      type: 'workspace_ingested',
      providersRun: 0,
      providersFailed: 0,
      requestsFailed: 0,
    });
  });
  it('retains partial persisted work and continues to the next provider', async () => {
    const deps = makeDeps();
    const configs =
      await deps.workspaceRepository.listProviderConfigs(workspaceId);
    if (configs.isError()) throw configs.getError();
    deps.workspaceRepository.listProviderConfigs = vi.fn(async () =>
      Result.Ok([...configs.get(), ...configs.get()])
    );
    deps.sourceRepository.createSourceRecord = vi
      .fn()
      .mockResolvedValueOnce(Result.Ok(sourceRecord))
      .mockResolvedValueOnce(Result.Error(appError('SOURCE_WRITE_FAILED')));
    const ingest = vi
      .fn()
      .mockResolvedValueOnce(
        Result.Ok({
          sourceRecords: [sourceRecord, sourceRecord],
          searchResults: [],
          requestsSucceeded: 1,
          requestsFailed: 0,
        })
      )
      .mockResolvedValueOnce(
        Result.Ok({
          sourceRecords: [],
          searchResults: [],
          requestsSucceeded: 1,
          requestsFailed: 0,
        })
      );
    deps.registry.get = vi.fn(() => ({
      name: 'awario' as const,
      isConfigured: () => true,
      runDailyIngest: ingest,
    }));
    const result = await runWorkspaceIngest(deps, { workspaceId, now });
    if (result.isError()) throw result.getError();
    expect(result.get()).toMatchObject({
      providersPartial: 1,
      providersRun: 1,
      providersFailed: 0,
      sourceRecords: 1,
      requestsSucceeded: 2,
      requestsFailed: 0,
    });
    expect(deps.ingestionRepository.finishRun).toHaveBeenNthCalledWith(
      1,
      ingestionRun.id,
      expect.objectContaining({ status: 'partial', itemsIngested: 1 })
    );
    expect(ingest).toHaveBeenCalledTimes(2);
  });

  describe('incremental window', () => {
    function makeWindowDeps(lastRun: LastSuccessfulRunOutcome) {
      const contexts: ProviderDailyContext[] = [];
      const deps = makeDeps({
        ingestionRepository: {
          ...makeDeps().ingestionRepository,
          getLastSuccessfulDailyRun: vi.fn(async () => Result.Ok(lastRun)),
        },
        registry: {
          get: vi.fn(() => ({
            name: 'awario' as const,
            isConfigured: () => true,
            runDailyIngest: async (ctx: ProviderDailyContext) => {
              contexts.push(ctx);
              return Result.Ok({ sourceRecords: [], searchResults: [] });
            },
          })),
          all: vi.fn(() => []),
        },
      });
      return { deps, contexts };
    }

    it('pulls the last 24 hours when the provider has never succeeded', async () => {
      const { deps, contexts } = makeWindowDeps({ type: 'no_previous_run' });
      const result = await runWorkspaceIngest(deps, { workspaceId, now });
      if (result.isError()) throw result.getError();
      expect(contexts[0]?.periodStart).toEqual(
        new Date('2026-05-31T00:00:00.000Z')
      );
    });

    it('starts where the last successful pull started and records the window', async () => {
      const lastStart = new Date('2026-05-31T20:00:00.000Z');
      const { deps, contexts } = makeWindowDeps({
        type: 'last_run_found',
        startedAt: lastStart,
      });
      const result = await runWorkspaceIngest(deps, { workspaceId, now });
      if (result.isError()) throw result.getError();
      expect(
        deps.ingestionRepository.getLastSuccessfulDailyRun
      ).toHaveBeenCalledWith({ workspaceId, providerName: 'awario' });
      expect(contexts[0]?.periodStart).toEqual(lastStart);
      expect(deps.ingestionRepository.finishRun).toHaveBeenCalledWith(
        ingestionRun.id,
        expect.objectContaining({
          status: 'succeeded',
          metadata: expect.objectContaining({
            periodStart: lastStart.toISOString(),
            periodEnd: now.toISOString(),
          }),
        })
      );
    });

    it('returns watermark lookup errors before starting a run', async () => {
      const deps = makeDeps({
        ingestionRepository: {
          ...makeDeps().ingestionRepository,
          getLastSuccessfulDailyRun: vi.fn(async () =>
            Result.Error(appError('INGESTION_RUN_LAST_SUCCESS_ERROR'))
          ),
        },
        registry: {
          get: vi.fn(() => ({
            name: 'awario' as const,
            isConfigured: () => true,
            runDailyIngest: vi.fn(),
          })),
          all: vi.fn(() => []),
        },
      });
      const result = await runWorkspaceIngest(deps, { workspaceId, now });
      expectErrorCode(result, 'INGESTION_RUN_LAST_SUCCESS_ERROR');
      expect(deps.ingestionRepository.startRun).not.toHaveBeenCalled();
    });
  });

  describe('overlapping window', () => {
    const lookbackMs = 3 * 24 * 60 * 60 * 1000;
    const storedPage = { ...sourceRecord, externalUrl: 'https://a.example/1' };
    const newPage = { ...sourceRecord, externalUrl: 'https://a.example/2' };

    function makeOverlapDeps(
      excludeStoredCopies: IngestionDeps['sourceRepository']['excludeStoredCopies']
    ) {
      const contexts: ProviderDailyContext[] = [];
      const deps = makeDeps({
        sourceRepository: {
          ...makeDeps().sourceRepository,
          excludeStoredCopies,
          createSourceRecord: vi.fn(async () => Result.Ok(sourceRecord)),
        },
        registry: {
          get: vi.fn(() => ({
            name: 'exa' as const,
            isConfigured: () => true,
            overlappingWindow: { lookbackMs },
            runDailyIngest: async (ctx: ProviderDailyContext) => {
              contexts.push(ctx);
              return Result.Ok({
                sourceRecords: [storedPage, newPage],
                searchResults: [],
              });
            },
          })),
          all: vi.fn(() => []),
        },
      });
      return { deps, contexts };
    }

    it('reaches back the full lookback and writes only records not already stored', async () => {
      const excludeStoredCopies = vi.fn(async () =>
        Result.Ok({ fresh: [newPage], storedCopies: 1 })
      );
      const { deps, contexts } = makeOverlapDeps(excludeStoredCopies);

      const result = await runWorkspaceIngest(deps, { workspaceId, now });
      if (result.isError()) throw result.getError();

      const periodStart = new Date(now.getTime() - lookbackMs);
      expect(contexts[0]?.periodStart).toEqual(periodStart);
      expect(
        deps.ingestionRepository.getLastSuccessfulDailyRun
      ).not.toHaveBeenCalled();
      expect(excludeStoredCopies).toHaveBeenCalledWith({
        workspaceId,
        providerName: 'awario',
        capturedSince: periodStart,
        records: [storedPage, newPage],
      });
      expect(deps.sourceRepository.createSourceRecord).toHaveBeenCalledOnce();
      expect(deps.sourceRepository.createSourceRecord).toHaveBeenCalledWith(
        newPage
      );
      expect(result.get()).toMatchObject({ sourceRecords: 1, providersRun: 1 });
      expect(deps.ingestionRepository.finishRun).toHaveBeenCalledWith(
        ingestionRun.id,
        expect.objectContaining({
          status: 'succeeded',
          itemsIngested: 1,
          metadata: expect.objectContaining({ storedCopiesSkipped: 1 }),
        })
      );
    });

    it('fails the provider run without writing when the stored-copy lookup fails', async () => {
      const { deps } = makeOverlapDeps(
        vi.fn(async () => Result.Error(appError('SOURCE_STORED_COPIES_ERROR')))
      );

      const result = await runWorkspaceIngest(deps, { workspaceId, now });
      if (result.isError()) throw result.getError();

      expect(result.get()).toMatchObject({ providersFailed: 1 });
      expect(deps.sourceRepository.createSourceRecord).not.toHaveBeenCalled();
      expect(deps.ingestionRepository.finishRun).toHaveBeenCalledWith(
        ingestionRun.id,
        expect.objectContaining({
          status: 'failed',
          failureReason: 'Stored copy lookup failed',
        })
      );
    });
  });
});

describe('resolveIngestWindowStart', () => {
  const day = 24 * 60 * 60 * 1000;

  it.each([
    {
      name: 'defaults to 24 hours with no previous run',
      lastSuccessfulRun: { type: 'no_previous_run' } as const,
      expected: new Date(now.getTime() - day),
    },
    {
      name: 'uses a recent watermark as-is',
      lastSuccessfulRun: {
        type: 'last_run_found',
        startedAt: new Date(now.getTime() - 4 * 60 * 60 * 1000),
      } as const,
      expected: new Date(now.getTime() - 4 * 60 * 60 * 1000),
    },
    {
      name: 'caps an old watermark at seven days back',
      lastSuccessfulRun: {
        type: 'last_run_found',
        startedAt: new Date(now.getTime() - 30 * day),
      } as const,
      expected: new Date(now.getTime() - 7 * day),
    },
    {
      name: 'pulls a future watermark back to now',
      lastSuccessfulRun: {
        type: 'last_run_found',
        startedAt: new Date(now.getTime() + day),
      } as const,
      expected: now,
    },
  ])('$name', ({ lastSuccessfulRun, expected }) => {
    expect(resolveIngestWindowStart({ now, lastSuccessfulRun })).toEqual(
      expected
    );
  });
});
