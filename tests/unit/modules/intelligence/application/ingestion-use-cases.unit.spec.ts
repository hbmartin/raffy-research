import { Result } from '@swan-io/boxed';
import { describe, expect, it, vi } from 'vitest';

import {
  handleProviderCallback,
  type HandleProviderCallbackOutcome,
  type IngestionDeps,
  type IngestionRun,
  type ProviderCallbackEvent,
  runWorkspaceIngest,
  type RunWorkspaceIngestOutcome,
  type Workspace,
} from '@/modules/intelligence';
import type { Logger } from '@/modules/kernel/application/ports/logger';
import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import {
  toIngestionRunId,
  toProviderCallbackEventId,
  toProviderConfigId,
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
    },
    ingestionRepository: {
      startRun: vi.fn(async () => Result.Ok(ingestionRun)),
      finishRun: vi.fn(async () => Result.Ok({ type: 'run_updated' as const })),
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
});
