import { createPgliteTestDatabase } from '@tests/server/pglite';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { SourceRecordWriteInput } from '@/modules/intelligence';
import {
  createPublicResearchArchive,
  createSourceRepository,
  intelligenceDrizzleSchema as schema,
} from '@/modules/intelligence/testing';
import { toWorkspaceId } from '@/modules/kernel/domain/ids';

const workspaceId = toWorkspaceId('ws-1');
const page = (
  overrides: Partial<SourceRecordWriteInput> = {}
): SourceRecordWriteInput => ({
  workspaceId,
  providerName: 'exa',
  sourceType: 'web_page',
  externalUrl: 'https://www.acme.example/Launch',
  contentText: 'Acme launches AI recall reminders.',
  capturedAt: new Date('2010-01-01T14:00:00Z'),
  ...overrides,
});
const requireOk = <T>(result: {
  isError(): boolean;
  getError(): unknown;
  get(): T;
}): T => {
  if (result.isError()) throw result.getError();
  return result.get();
};

describe('Atomic capture versions and observations', () => {
  let database: Awaited<ReturnType<typeof createPgliteTestDatabase>>;
  beforeAll(async () => {
    database = await createPgliteTestDatabase();
  });
  beforeEach(async () => {
    await database.truncate();
    await database.db.insert(schema.workspace).values({
      id: workspaceId,
      name: 'Workspace',
      companyName: 'Acme',
      companyDescription: 'Test',
      subcategory: 'B2B SaaS',
      timezone: 'UTC',
    });
  });
  afterAll(async () => {
    await database?.close();
  });

  it('reuses exact versions across all history and concurrent writes, preserving original dates and every observation', async () => {
    const repository = createSourceRepository({ db: database.db });
    const original = requireOk(
      await repository.captureSourceRecord({
        record: page(),
        observation: { kind: 'pull', runId: 'old-run' },
      })
    );
    const copies = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        repository.captureSourceRecord({
          record: page({
            externalUrl: 'https://acme.example/Launch/?utm_source=mail',
            capturedAt: new Date(),
          }),
          observation: {
            kind: 'pull',
            runId: `run-${index}`,
            observedAt: new Date(),
          },
        })
      )
    );
    expect(original.type).toBe('capture_created');
    for (const copy of copies)
      expect(requireOk(copy)).toMatchObject({
        type: 'capture_reused',
        sourceRecord: {
          id: original.sourceRecord.id,
          capturedAt: page().capturedAt,
        },
      });
    expect(await database.db.select().from(schema.sourceRecord)).toHaveLength(
      1
    );
    expect(
      await database.db.select().from(schema.captureObservation)
    ).toHaveLength(5);
    const current = requireOk(
      await repository.listForPeriod({
        workspaceId,
        periodStart: new Date(Date.now() - 60_000),
        periodEnd: new Date(Date.now() + 60_000),
      })
    );
    expect(current[0]?.id).toBe(original.sourceRecord.id);
  });
  it('reuses within a batch and callback reprocessing and associates every search result with its capture', async () => {
    const repository = createSourceRepository({ db: database.db });
    const input = {
      sourceRecords: [page(), page()],
      searchResults: [
        {
          workspaceId,
          providerName: 'exa',
          query: 'keyword-one',
          url: page().externalUrl,
        },
        {
          workspaceId,
          providerName: 'exa',
          query: 'keyword-two',
          url: page().externalUrl,
        },
      ],
      observation: { kind: 'callback' as const, callbackId: 'callback-one' },
    };
    const first = requireOk(await repository.createCallbackArtifacts(input));
    const second = requireOk(
      await repository.createCallbackArtifacts({
        ...input,
        observation: { kind: 'callback', callbackId: 'callback-two' },
      })
    );
    expect(first).toMatchObject({
      createdCaptures: 1,
      reusedCaptures: 1,
      observations: 4,
    });
    expect(
      first.searchResults.map((search) => search.metadata?.callbackId)
    ).toEqual(['callback-one', 'callback-one']);
    expect(second).toMatchObject({
      createdCaptures: 0,
      reusedCaptures: 2,
      observations: 4,
    });
    expect(
      new Set(
        [...first.searchResults, ...second.searchResults].map(
          (search) => search.sourceRecordId
        )
      )
    ).toEqual(new Set([first.sourceRecords[0]!.id]));
    expect(await database.db.select().from(schema.searchResult)).toHaveLength(
      4
    );
    expect(
      await database.db.select().from(schema.captureObservation)
    ).toHaveLength(4);
  });
  it('preserves material versions, provider snapshots and case-sensitive and escaped URL distinctions', async () => {
    const repository = createSourceRepository({ db: database.db });
    const versions = [
      page(),
      page({ contentText: 'Acme has withdrawn its recall product.' }),
      page({ externalUrl: 'https://acme.example/launch' }),
      page({ externalUrl: 'https://acme.example/Launch?x=a%26y%3Db' }),
      page({ externalUrl: 'https://acme.example/Launch?x=a&y=b' }),
      page({ externalUrl: 'https://acme.example/Launch?x=ABC' }),
      page({ externalUrl: 'https://acme.example/Launch?x=abc' }),
      page({ providerName: 'apify' }),
      page({
        externalUrl: null,
        providerName: 'semrush',
        rawPayload: { rank: 2 },
      }),
      page({
        externalUrl: null,
        providerName: 'semrush',
        rawPayload: { rank: 3 },
      }),
    ];
    const result = requireOk(
      await repository.createCallbackArtifacts({ sourceRecords: versions })
    );
    expect(result.createdCaptures).toBe(versions.length);
    expect(result.sourceRecords[0]!.evidenceIdentity).not.toBe(
      result.sourceRecords[1]!.evidenceIdentity
    );
    const observations = await database.db
      .select()
      .from(schema.captureObservation)
      .where(eq(schema.captureObservation.providerName, 'semrush'));
    expect(observations.map((o) => o.rawPayload)).toEqual([
      { rank: 2 },
      { rank: 3 },
    ]);
  });
  it('rolls back captures, registry reservations and observations when any batch write fails', async () => {
    const repository = createSourceRepository({ db: database.db });
    const result = await repository.createCallbackArtifacts({
      sourceRecords: [
        page(),
        page({ workspaceId: toWorkspaceId('missing-workspace') }),
      ],
    });
    expect(result.isError()).toBe(true);
    expect(await database.db.select().from(schema.sourceRecord)).toHaveLength(
      0
    );
    expect(await database.db.select().from(schema.captureVersion)).toHaveLength(
      0
    );
    expect(
      await database.db.select().from(schema.captureObservation)
    ).toHaveLength(0);
  });
  it('shares the latest explicit Keep/Junk judgment across clear copies without changing raw capture history', async () => {
    const repository = createSourceRepository({ db: database.db });
    const first = requireOk(await repository.createSourceRecord(page()));
    const copy = requireOk(
      await repository.createSourceRecord(
        page({
          externalUrl: 'https://syndicated.example/copy',
          contentText: '# Acme launches AI recall reminders.\nCookie settings',
        })
      )
    );
    const revision = requireOk(
      await repository.createSourceRecord(
        page({ contentText: 'Acme has withdrawn its recall product.' })
      )
    );
    await repository.setRelevanceLabel({
      workspaceId,
      sourceRecordId: first.id,
      label: 'junk',
      labeledAt: new Date('2026-10-01T10:00:00Z'),
    });
    expect(
      requireOk(await repository.getManyByIds(workspaceId, [copy.id]))[0]
        ?.relevanceLabel
    ).toBe('junk');
    await repository.setRelevanceLabel({
      workspaceId,
      sourceRecordId: copy.id,
      label: 'keep',
      labeledAt: new Date('2026-10-01T11:00:00Z'),
    });
    expect(
      requireOk(await repository.getManyByIds(workspaceId, [first.id]))[0]
        ?.relevanceLabel
    ).toBe('keep');
    expect(
      requireOk(await repository.getManyByIds(workspaceId, [revision.id]))[0]
        ?.relevanceLabel
    ).toBeNull();
    await repository.setRelevanceLabel({
      workspaceId,
      sourceRecordId: first.id,
      label: null,
      labeledAt: new Date('2026-10-01T12:00:00Z'),
    });
    expect(
      requireOk(await repository.getManyByIds(workspaceId, [copy.id]))[0]
        ?.relevanceLabel
    ).toBeNull();
    const [stored] = await database.db
      .select()
      .from(schema.sourceRecord)
      .where(
        and(
          eq(schema.sourceRecord.id, copy.id),
          eq(schema.sourceRecord.workspaceId, workspaceId)
        )
      );
    expect(stored?.relevanceLabel).toBe('keep');
    expect(
      await database.db.select().from(schema.evidenceJudgment)
    ).toHaveLength(3);
  });
  it('suggests uncertain near copies and retains confirm/separate decisions independently of retraction', async () => {
    const repository = createSourceRepository({ db: database.db });
    const content = Array.from({ length: 70 }, (_, i) => `word${i}`).join(' ');
    const left = requireOk(
      await repository.createSourceRecord(
        page({
          contentText: content,
          publishedAt: new Date('2020-01-01T00:00:00Z'),
        })
      )
    );
    const right = requireOk(
      await repository.createSourceRecord(
        page({
          contentText: `${content} additional caveat`,
          publishedAt: new Date('2019-01-01T00:00:00Z'),
        })
      )
    );
    expect(left.evidenceIdentity).not.toBe(right.evidenceIdentity);
    const archive = createPublicResearchArchive(database.db);
    const reviews = requireOk(await archive.equivalenceReviews('ws-1'));
    expect(reviews.reviews).toHaveLength(1);
    const reviewId = reviews.reviews[0]!.id;
    await repository.setRelevanceLabel({
      workspaceId,
      sourceRecordId: left.id,
      label: 'junk',
      labeledAt: new Date(),
    });
    requireOk(
      await archive.decideEquivalence({
        workspaceId,
        reviewId,
        actorId: 'reader',
        action: 'confirm',
      })
    );
    expect(
      requireOk(await repository.getManyByIds(workspaceId, [right.id]))[0]
        ?.relevanceLabel
    ).toBe('junk');
    requireOk(
      await archive.decideEquivalence({
        workspaceId,
        reviewId,
        actorId: 'reader',
        action: 'separate',
      })
    );
    expect(
      requireOk(await repository.getManyByIds(workspaceId, [right.id]))[0]
        ?.relevanceLabel
    ).toBeNull();
    expect(
      await database.db.select().from(schema.evidenceEquivalenceDecision)
    ).toHaveLength(2);
    const data = requireOk(
      await archive.read(workspaceId, { sourceIds: [left.id, right.id] })
    );
    if ('type' in data) throw new Error('Expected archive');
    expect(data.sources).toHaveLength(2);
    expect(
      data.sources.find((source) => source.id === left.id)?.originPublishedAt
    ).toBe('2020-01-01T00:00:00.000Z');
    expect(
      data.sources.find((source) => source.id === right.id)?.originPublishedAt
    ).toBe('2019-01-01T00:00:00.000Z');
    const groups = await database.db.select().from(schema.evidenceGroup);
    expect(
      groups.find(
        (group) =>
          group.identity ===
          data.sources.find((source) => source.id === left.id)?.identity
      )?.representativeId
    ).toBe(left.id);
  });
});
