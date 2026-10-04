import { createPgliteTestDatabase } from '@tests/server/pglite';
import { requireOk } from '@tests/support/newsletter';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  backfillCaptureHistory,
  createPublicResearchArchive,
  createSourceRepository,
  intelligenceDrizzleSchema as schema,
} from '@/modules/intelligence/testing';
import { toWorkspaceId } from '@/modules/kernel';

const workspaceId = toWorkspaceId('copies');
const body = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
describe('Reversible editorial equivalence with PostgreSQL persistence', () => {
  let database: Awaited<ReturnType<typeof createPgliteTestDatabase>>;
  beforeAll(async () => {
    database = await createPgliteTestDatabase();
  });
  beforeEach(async () => {
    await database.truncate();
    await database.db.insert(schema.workspace).values({
      id: workspaceId,
      name: 'Copies',
      companyName: 'Acme',
      companyDescription: 'Test',
      subcategory: 'Test',
      timezone: 'UTC',
    });
  });
  afterAll(async () => {
    await database.close();
  });
  const capture = async (
    id: string,
    contentText = body,
    sourceType: 'web_page' | 'seo_report' = 'web_page'
  ) =>
    requireOk(
      await createSourceRepository({ db: database.db }).createSourceRecord({
        workspaceId,
        providerName: 'exa',
        sourceType,
        externalUrl: `https://example.org/${id}`,
        contentText,
        publishedAt: new Date(id === 'a' ? '2020-01-01' : '2021-01-01'),
      })
    );
  const review = async (left: string, right: string) => {
    const [leftSourceId, rightSourceId] = [left, right].sort();
    await database.db
      .insert(schema.evidenceEquivalenceReview)
      .values({
        workspaceId,
        leftSourceId: leftSourceId!,
        rightSourceId: rightSourceId!,
      })
      .onConflictDoNothing();
    const [row] = await database.db
      .select()
      .from(schema.evidenceEquivalenceReview)
      .where(
        and(
          eq(schema.evidenceEquivalenceReview.leftSourceId, leftSourceId!),
          eq(schema.evidenceEquivalenceReview.rightSourceId, rightSourceId!)
        )
      );
    return row!.id;
  };
  const decide = (
    reviewId: string,
    action: 'confirm' | 'separate' | 'reverse'
  ) =>
    createPublicResearchArchive(database.db).decideEquivalence!({
      workspaceId,
      reviewId,
      actorId: 'reader',
      action,
    });
  it('keeps short cross-URL prose, blocking pages, and structured metrics independent, while suggesting short copies', async () => {
    const a = await capture('short-a', 'A short announcement.'),
      b = await capture('short-b', '# A short announcement.');
    expect(a.evidenceIdentity).not.toBe(b.evidenceIdentity);
    expect(
      await database.db.select().from(schema.evidenceEquivalenceReview)
    ).toHaveLength(1);
    const deniedA = await capture('denied-a', `Access denied ${body}`),
      deniedB = await capture('denied-b', `Access denied ${body}`);
    expect(deniedA.evidenceIdentity).not.toBe(deniedB.evidenceIdentity);
    const metricA = await capture('metric-a', body, 'seo_report'),
      metricB = await capture('metric-b', body, 'seo_report');
    expect(metricA.evidenceIdentity).not.toBe(metricB.evidenceIdentity);
    expect(
      await database.db.select().from(schema.evidenceEquivalenceReview)
    ).toHaveLength(1);
  });
  it('splits whole base copy groups and restores their own latest judgments and publication dates', async () => {
    const a = await capture('a'),
      a2 = await capture('a2', `# ${body}\nCookie settings`),
      a3 = await capture('a3');
    const b = await capture('b', `${body} revised`),
      b2 = await capture('b2', `${body} revised`);
    const repository = createSourceRepository({ db: database.db });
    requireOk(
      await repository.setRelevanceLabel({
        workspaceId,
        sourceRecordId: a.id,
        label: 'junk',
        labeledAt: new Date('2026-01-01'),
      })
    );
    requireOk(
      await repository.setRelevanceLabel({
        workspaceId,
        sourceRecordId: b.id,
        label: 'keep',
        labeledAt: new Date('2026-02-01'),
      })
    );
    const relationship = await review(a.id, b.id);
    expect(requireOk(await decide(relationship, 'confirm')).type).toBe('saved');
    expect(
      requireOk(await repository.getManyByIds(workspaceId, [a2.id]))[0]!
        .relevanceLabel
    ).toBe('keep');
    expect(requireOk(await decide(relationship, 'separate')).type).toBe(
      'saved'
    );
    const sources = requireOk(
      await repository.getManyByIds(workspaceId, [
        a.id,
        a2.id,
        a3.id,
        b.id,
        b2.id,
      ])
    );
    expect(
      new Set(
        sources
          .filter((source) => [a.id, a2.id, a3.id].includes(source.id))
          .map((source) => source.evidenceIdentity)
      ).size
    ).toBe(1);
    expect(
      sources
        .filter((source) => [a.id, a2.id, a3.id].includes(source.id))
        .every((source) => source.relevanceLabel === 'junk')
    ).toBe(true);
    expect(
      sources
        .filter((source) => [b.id, b2.id].includes(source.id))
        .every((source) => source.relevanceLabel === 'keep')
    ).toBe(true);
    const groups = await database.db.select().from(schema.evidenceGroup);
    expect(groups).toHaveLength(2);
    expect(
      groups
        .map((group) => group.publicationDate.toISOString().slice(0, 10))
        .sort()
    ).toEqual(['2020-01-01', '2021-01-01']);
    expect(
      await database.db.select().from(schema.evidenceJudgment)
    ).toHaveLength(2);
    expect(
      await database.db.select().from(schema.evidenceEquivalenceDecision)
    ).toHaveLength(2);
    expect(
      await database.db.select().from(schema.captureObservation)
    ).toHaveLength(5);
  });
  it('returns alternate connecting confirmations and requires explicit reversal of conflicts', async () => {
    const a = await capture('a'),
      b = await capture('b', `${body} revised`),
      c = await capture('c', `${body} alternate`);
    const ab = await review(a.id, b.id),
      bc = await review(b.id, c.id),
      ac = await review(a.id, c.id);
    for (const id of [ab, bc, ac]) requireOk(await decide(id, 'confirm'));
    const conflict = requireOk(await decide(ab, 'separate'));
    expect(conflict.type).toBe('equivalence_conflict');
    if (conflict.type !== 'equivalence_conflict')
      throw new Error('Expected conflict');
    expect(conflict.blockingReviews.map((edge) => edge.id).sort()).toEqual(
      [ac, bc].sort()
    );
    requireOk(await decide(ac, 'reverse'));
    requireOk(await decide(ab, 'separate'));
    const contradiction = requireOk(await decide(ac, 'confirm'));
    expect(contradiction).toMatchObject({
      type: 'equivalence_conflict',
      blockingReviews: [{ id: ab }],
    });
    requireOk(await decide(ab, 'reverse'));
    expect(requireOk(await decide(ac, 'confirm')).type).toBe('saved');
  });
  it('serializes concurrent decisions and capture insertion without fracturing copies', async () => {
    const a = await capture('a'),
      b = await capture('b', `${body} revised`),
      ab = await review(a.id, b.id);
    const results = await Promise.all([
      decide(ab, 'confirm'),
      capture('new-a'),
      capture('new-b', `${body} revised`),
    ]);
    expect(
      requireOk(results[0]! as Awaited<ReturnType<typeof decide>>).type
    ).toBe('saved');
    expect(
      new Set(
        (await database.db.select().from(schema.sourceRecord)).map(
          (source) => source.evidenceIdentity
        )
      ).size
    ).toBe(1);
    expect(
      await database.db.select().from(schema.captureObservation)
    ).toHaveLength(4);
  });
  it('preflights historical contradictions and leaves derived memberships and judgments untouched', async () => {
    const a = await capture('a'),
      b = await capture('b', `${body} revised`),
      c = await capture('c', `${body} alternate`);
    const ab = await review(a.id, b.id),
      bc = await review(b.id, c.id),
      ac = await review(a.id, c.id);
    requireOk(await decide(ab, 'confirm'));
    requireOk(await decide(bc, 'confirm'));
    await database.db
      .update(schema.evidenceEquivalenceReview)
      .set({ status: 'separate' })
      .where(eq(schema.evidenceEquivalenceReview.id, ac));
    const before = await database.db.select().from(schema.sourceRecord);
    const result = await backfillCaptureHistory(database.db);
    if (result.isOk()) throw new Error('Expected contradiction');
    expect(result.getError()).toMatchObject({
      code: 'EQUIVALENCE_MIGRATION_CONFLICT',
      details: { conflicts: [{ separation: { id: ac } }] },
    });
    expect(await database.db.select().from(schema.sourceRecord)).toEqual(
      before
    );
  });
});
