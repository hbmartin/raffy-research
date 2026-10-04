import { Result } from '@swan-io/boxed';
import { createPgliteTestDatabase } from '@tests/server/pglite';
import {
  articleFixture,
  auditFixture,
  newsletterNow,
  requireOk,
  stateFixture,
} from '@tests/support/newsletter';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  sourceRecord,
  workspace,
} from '@/modules/intelligence/infrastructure/drizzle/schema';
import {
  backfillCaptureHistory,
  createSourceRepository,
} from '@/modules/intelligence/testing';
import { toWorkspaceId } from '@/modules/kernel';
import type { NewsletterState } from '@/modules/newsletter/domain/newsletter';
import {
  newsletterJob,
  newsletterWorkspace,
} from '@/modules/newsletter/infrastructure/drizzle/schema';
import {
  backfillNewsletterHistory,
  createNewsletterRepository,
} from '@/modules/newsletter/testing';

describe('Preservation backfill and bounded newsletter reads', () => {
  let database: Awaited<ReturnType<typeof createPgliteTestDatabase>>;
  beforeAll(async () => {
    database = await createPgliteTestDatabase();
  });
  beforeEach(async () => {
    await database.reset();
    await database.db.insert(workspace).values({
      id: 'ws-1',
      name: 'Test',
      companyName: 'Test',
      companyDescription: 'Test',
      subcategory: 'Dental',
      timezone: 'UTC',
    });
  });
  afterAll(async () => {
    await database?.close();
  });
  it('recovers completed legacy repairs while retaining failed attempts and existing owners', async () => {
    const state = stateFixture();
    await database.db
      .insert(newsletterWorkspace)
      .values({ workspaceId: 'ws-1', state });
    const checkpoint = {
      version: 2 as const,
      profile: state.profile!,
      styleCursor: 1,
      styleNotes: ['Completed style'],
      unitRepairs: { 'style:0': 1 },
      legacyRepairBlocked: true,
    };
    await database.db.insert(newsletterJob).values(
      ['queued', 'failed'].map((status) => ({
        id: status,
        key: status,
        workspaceId: 'ws-1',
        mode: 'local' as const,
        kind: 'draft' as const,
        runtime: state.profile!.runtime,
        checkpoint,
        status: status as 'queued' | 'failed',
      }))
    );
    requireOk(
      await backfillNewsletterHistory(database.db, {
        'ws-1': 'different-operator',
      })
    );
    const repository = createNewsletterRepository(database.db);
    const queued = requireOk(await repository.getJob('ws-1', 'queued'));
    expect(queued).toMatchObject({
      type: 'job_found',
      job: {
        status: 'queued',
        localOperatorId: 'reader',
        checkpoint: {
          version: 3,
          repairUnits: { 'style:0': { repairsUsed: 1, exhausted: false } },
        },
      },
    });
    if (queued.type === 'job_found')
      expect(queued.job.checkpoint.legacyRepairBlocked).toBeUndefined();
    expect(requireOk(await repository.getJob('ws-1', 'failed'))).toMatchObject({
      type: 'job_found',
      job: { status: 'failed', checkpoint },
    });
    expect(
      requireOk(await repository.read('ws-1')).profile!.runtime.localOperatorId
    ).toBe('reader');
  });
  it('preserves every capture payload and date, creates idempotent indexes and reuses legacy copies', async () => {
    const capturedAt = new Date('2020-01-01T00:00:00Z');
    await database.db.insert(sourceRecord).values(
      ['legacy-a', 'legacy-b'].map((id) => ({
        id,
        workspaceId: 'ws-1',
        providerName: 'exa',
        sourceType: 'web_page',
        externalUrl: 'https://example.org/Original?Case=A',
        contentText: 'A complete historical evidence passage.',
        capturedAt,
        publishedAt: new Date('2019-12-30T00:00:00Z'),
        metadata: { original: true },
        rawPayload: { originalResponse: 'unchanged' },
        relevanceLabel: 'junk' as const,
        labeledAt: capturedAt,
      }))
    );
    const original = await database.db.select().from(sourceRecord);
    requireOk(await backfillCaptureHistory(database.db));
    requireOk(await backfillCaptureHistory(database.db));
    const stored = await database.db.select().from(sourceRecord);
    for (const row of original) {
      const after = stored.find((s) => s.id === row.id)!;
      expect(after).toMatchObject({
        id: row.id,
        capturedAt: row.capturedAt,
        publishedAt: row.publishedAt,
        updatedAt: row.updatedAt,
        contentText: row.contentText,
        metadata: row.metadata,
        rawPayload: row.rawPayload,
        relevanceLabel: row.relevanceLabel,
        labeledAt: row.labeledAt,
      });
      expect(after.evidenceIdentity).toBe(stored[0]!.evidenceIdentity);
    }
    const capture = requireOk(
      await createSourceRepository({ db: database.db }).captureSourceRecord({
        record: {
          workspaceId: toWorkspaceId('ws-1'),
          providerName: 'exa',
          sourceType: 'web_page',
          externalUrl: original[0]!.externalUrl,
          contentText: original[0]!.contentText,
          capturedAt: new Date(),
        },
        observation: { kind: 'pull' },
      })
    );
    expect(capture.type).toBe('capture_reused');
    expect(capture.sourceRecord.id).toBe('legacy-a');
    expect(capture.sourceRecord.capturedAt).toEqual(capturedAt);
    const result = await database.db.$client.query<{ count: number }>(
      'select count(*)::int as count from "captureObservation"'
    );
    expect(result.rows[0]!.count).toBe(3);
    expect(stored).toHaveLength(2);
  });
  it('moves immutable drafts and offers into paginated history and assigns local ownership only by mapping', async () => {
    const state = stateFixture();
    delete state.profile!.runtime.localOperatorId;
    state.drafts = Array.from({ length: 26 }, (_, index) => ({
      ...articleFixture,
      id: `legacy-draft-${String(index).padStart(2, '0')}`,
      selectionId: 'legacy-selection',
      createdAt: new Date(newsletterNow.getTime() + index * 1000).toISOString(),
      profile: structuredClone(state.profile!),
      feedback: '',
      audit: auditFixture,
      auditHistory: [auditFixture],
      runtime: structuredClone(state.profile!.runtime),
      sources: state.sources,
      jobId: `legacy-job-${index}`,
    }));
    state.offerHistory = [
      {
        jobId: 'legacy-offer',
        reportId: 'report-1',
        createdAt: newsletterNow.toISOString(),
        themes: [],
      },
    ];
    await database.db
      .insert(newsletterWorkspace)
      .values({ workspaceId: 'ws-1', state });
    await database.db.insert(newsletterJob).values({
      id: 'legacy-local',
      key: 'legacy-local',
      workspaceId: 'ws-1',
      mode: 'local',
      kind: 'draft',
      runtime: state.profile!.runtime,
      checkpoint: { profile: state.profile! },
    });
    requireOk(await backfillNewsletterHistory(database.db, {}));
    const repository = createNewsletterRepository(database.db);
    expect(
      requireOk(
        await repository.claim('local', new Date(), 'unmapped', 'reader')
      ).type
    ).toBe('queue_empty');
    requireOk(
      await backfillNewsletterHistory(database.db, { 'ws-1': 'reader' })
    );
    const first = requireOk(await repository.history('ws-1'));
    expect(first.entries).toHaveLength(20);
    expect(first.nextCursor).toBeTruthy();
    const second = requireOk(
      await repository.history('ws-1', first.nextCursor!)
    );
    expect(
      new Set(
        [...first.entries, ...second.entries]
          .filter((e) => e.kind === 'draft')
          .map((e) => e.id)
      ).size
    ).toBe(26);
    for (const draft of state.drafts)
      expect(requireOk(await repository.detail('ws-1', draft.id))).toEqual({
        type: 'detail_found',
        payload: JSON.parse(JSON.stringify(draft)),
      });
    const view = requireOk(await repository.read('ws-1', { content: false }));
    expect(view.drafts).toHaveLength(20);
    expect(view.drafts[0]!.sources[0]!.content).toBeUndefined();
    expect(view.sources[0]!.content).toBe('');
    const claimed = requireOk(
      await repository.claim(
        'local',
        new Date('2090-01-01'),
        'mapped',
        'reader'
      )
    );
    expect(claimed.type).toBe('job_claimed');
    if (claimed.type === 'job_claimed')
      expect(claimed.job).toMatchObject({
        localOperatorId: 'reader',
        contextBudget: 128000,
      });
    const raw = await database.db.$client.query<{ state: NewsletterState }>(
      'select state from "newsletterWorkspace"'
    );
    expect(raw.rows[0]!.state.drafts).toEqual([]);
    expect(raw.rows[0]!.state.offerHistory).toEqual([]);
  });
  it('reports a no-op enqueue accurately without saving its speculative state change', async () => {
    const repository = createNewsletterRepository(database.db);
    const state = stateFixture();
    const job = {
      id: 'stable',
      workspaceId: 'ws-1',
      key: 'publication:ws-1:report-1',
      kind: 'prepare' as const,
      runtime: state.profile!.runtime,
      localOperatorId: 'reader',
      selectionId: null,
      feedback: '',
      status: 'failed' as const,
      stage: 'failed',
      checkpoint: {},
      leaseToken: null,
      leaseUntil: null,
      failure: 'Preserved failure',
      createdAt: newsletterNow,
    };
    const enqueue = () =>
      repository.mutate<{ type: 'enqueued' | 'already_present' }>(
        'ws-1',
        (current) => {
          current.profile = state.profile;
          current.revision = 123;
          return Result.Ok({
            value: { type: 'enqueued' as const },
            alreadyPresent: { type: 'already_present' as const },
            jobs: [job],
          });
        }
      );
    expect(requireOk(await enqueue()).type).toBe('enqueued');
    const before = requireOk(await repository.read('ws-1'));
    expect(requireOk(await enqueue()).type).toBe('already_present');
    expect(requireOk(await repository.read('ws-1'))).toEqual(before);
    expect(requireOk(await repository.getJob('ws-1', job.id))).toMatchObject({
      type: 'job_found',
      job: { status: 'failed', failure: 'Preserved failure' },
    });
  });
});
