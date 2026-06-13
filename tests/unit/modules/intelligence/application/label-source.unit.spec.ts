import { Result } from '@swan-io/boxed';
import { describe, expect, it, vi } from 'vitest';

import {
  createIntelligenceUseCases,
  type IntelligenceUseCaseDeps,
  type SourceRecord,
} from '@/modules/intelligence';
import { toSourceRecordId, toUserId, toWorkspaceId } from '@/modules/kernel';
import type { Logger } from '@/modules/kernel/application/ports/logger';

const now = new Date('2026-06-01T00:00:00.000Z');
const workspaceId = toWorkspaceId('ws-1');
const otherWorkspaceId = toWorkspaceId('ws-2');
const userId = toUserId('user-1');
const sourceRecordId = toSourceRecordId('source-1');

const makeLogger = (): Logger => ({
  debug: vi.fn<Logger['debug']>(),
  info: vi.fn<Logger['info']>(),
  warn: vi.fn<Logger['warn']>(),
  error: vi.fn<Logger['error']>(),
});

const sourceRecord = {
  id: sourceRecordId,
  workspaceId,
  providerName: 'exa',
  providerSourceId: null,
  sourceType: 'web_page',
  sourceSubtype: null,
  sourceName: null,
  sourceUrl: null,
  externalUrl: null,
  title: null,
  authorOrAccount: null,
  domain: null,
  publishedAt: null,
  capturedAt: now,
  contentText: null,
  diffAddedText: null,
  diffRemovedText: null,
  rawPayload: null,
  metadata: null,
  relevanceLabel: null,
  labeledAt: null,
  createdAt: now,
  updatedAt: now,
} satisfies SourceRecord;

function makeDeps(
  overrides: Partial<IntelligenceUseCaseDeps> = {}
): IntelligenceUseCaseDeps {
  const deps = {
    workspaceRepository: {},
    sourceRepository: {
      getById: vi.fn(async () =>
        Result.Ok({ type: 'source_record_found' as const, sourceRecord })
      ),
      setRelevanceLabel: vi.fn(async () =>
        Result.Ok({
          type: 'source_labeled' as const,
          sourceRecord: {
            ...sourceRecord,
            relevanceLabel: 'junk' as const,
            labeledAt: now,
          },
        })
      ),
    },
    reportRepository: {},
    rubricScoreRepository: {},
    ingestionRepository: {},
    permissionChecker: {
      hasPermission: vi.fn(async () =>
        Result.Ok({ type: 'permission_granted' as const })
      ),
    },
    idGenerator: { createId: vi.fn() },
    clock: { now: vi.fn(() => now) },
    logger: makeLogger(),
  } as unknown as IntelligenceUseCaseDeps;

  return { ...deps, ...overrides };
}

function expectOkType(
  result: Awaited<
    ReturnType<ReturnType<typeof createIntelligenceUseCases>['labelSource']>
  >
) {
  if (result.isError()) throw result.getError();
  return result.get().type;
}

describe('labelSource', () => {
  it('labels a source in the requested workspace', async () => {
    const deps = makeDeps();
    const useCases = createIntelligenceUseCases(deps);

    const result = await useCases.labelSource({
      currentUserId: userId,
      workspaceId,
      sourceRecordId,
      label: 'junk',
    });

    expect(expectOkType(result)).toBe('source_labeled');
    expect(deps.sourceRepository.setRelevanceLabel).toHaveBeenCalledWith({
      workspaceId,
      sourceRecordId,
      label: 'junk',
      labeledAt: now,
    });
  });

  it('does not label a source from another workspace', async () => {
    const deps = makeDeps({
      sourceRepository: {
        ...makeDeps().sourceRepository,
        getById: vi.fn(async () =>
          Result.Ok({
            type: 'source_record_found' as const,
            sourceRecord: { ...sourceRecord, workspaceId: otherWorkspaceId },
          })
        ),
      },
    });
    const useCases = createIntelligenceUseCases(deps);

    const result = await useCases.labelSource({
      currentUserId: userId,
      workspaceId,
      sourceRecordId,
      label: 'keep',
    });

    expect(expectOkType(result)).toBe('forbidden');
    expect(deps.sourceRepository.setRelevanceLabel).not.toHaveBeenCalled();
  });

  it('clears a label with null', async () => {
    const deps = makeDeps();
    const useCases = createIntelligenceUseCases(deps);

    const result = await useCases.labelSource({
      currentUserId: userId,
      workspaceId,
      sourceRecordId,
      label: null,
    });

    expect(expectOkType(result)).toBe('source_labeled');
    expect(deps.sourceRepository.setRelevanceLabel).toHaveBeenCalledWith(
      expect.objectContaining({ label: null })
    );
  });
});
