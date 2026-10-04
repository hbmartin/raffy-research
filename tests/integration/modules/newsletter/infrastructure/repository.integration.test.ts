import { Result } from '@swan-io/boxed';
import { createPgliteTestDatabase } from '@tests/server/pglite';
import {
  newsletterNow,
  newsletterProfile,
  requireOk,
  stateFixture,
} from '@tests/support/newsletter';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { workspace } from '@/modules/intelligence/infrastructure/drizzle/schema';
import type { NewsletterJob } from '@/modules/newsletter';
import { newsletterJob } from '@/modules/newsletter/infrastructure/drizzle/schema';
import { createNewsletterRepository } from '@/modules/newsletter/testing';

describe('Newsletter transactional persistence', () => {
  let database: Awaited<ReturnType<typeof createPgliteTestDatabase>>;
  beforeAll(async () => {
    database = await createPgliteTestDatabase();
  });
  beforeEach(async () => {
    await database.truncate();
    await database.db.insert(workspace).values({
      id: 'ws-1',
      name: 'Test',
      companyName: 'Insider',
      companyDescription: 'Dental workflows',
      subcategory: 'Dental',
      timezone: 'UTC',
    });
  });
  afterAll(async () => {
    await database?.close();
  });
  it('reads typed lightweight summaries and loads complete diagnostics only on demand', async () => {
    const repository = createNewsletterRepository(database.db);
    const job: NewsletterJob = {
      id: 'diagnostic-job',
      key: 'diagnostic-job',
      workspaceId: 'ws-1',
      kind: 'prepare',
      runtime: newsletterProfile.runtime,
      contextBudget: 128000,
      status: 'failed',
      stage: 'tracking',
      selectionId: null,
      feedback: '',
      checkpoint: {
        version: 2,
        styleNotes: ['bulky diagnostic '.repeat(20000)],
        repairUnits: {
          'tracking:report:0': {
            repairsUsed: 2,
            needsRepair: true,
            rejected: { text: 'Rejected output' },
          },
        },
      },
      leaseToken: null,
      leaseUntil: null,
      failure: 'Malformed tracking output',
      createdAt: newsletterNow,
    };
    requireOk(
      await repository.mutate('ws-1', () =>
        Result.Ok({ value: { type: 'queued' as const }, jobs: [job] })
      )
    );
    const summaries = requireOk(await repository.listJobSummaries('ws-1'));
    expect(summaries[0]).toMatchObject({ id: job.id, failure: job.failure });
    expect(summaries[0]).not.toHaveProperty('checkpoint');
    expect(summaries[0]).not.toHaveProperty('leaseToken');
    expect(JSON.stringify(summaries).length).toBeLessThan(2000);
    const full = requireOk(await repository.getJob('ws-1', job.id));
    expect(full).toMatchObject({
      type: 'job_found',
      job: { checkpoint: job.checkpoint },
    });
    expect(
      requireOk(await repository.getJob('different-workspace', job.id))
    ).toEqual({ type: 'not_found' });
  });
  it('orders active work oldest first and completed failures newest first, with deterministic ties', async () => {
    const repository = createNewsletterRepository(database.db);
    const jobs = Array.from({ length: 8 }, (_, i): NewsletterJob => ({
      id: `failed-${i}`,
      key: `failed-${i}`,
      workspaceId: 'ws-1',
      kind: 'prepare',
      runtime: newsletterProfile.runtime,
      status: 'failed',
      stage: 'failed',
      selectionId: null,
      feedback: '',
      checkpoint: {},
      leaseToken: null,
      leaseUntil: null,
      failure: `Failure ${i}`,
      createdAt: new Date(newsletterNow.getTime() + Math.floor(i / 2) * 1000),
    }));
    jobs.push(
      ...['b', 'a'].map((id): NewsletterJob => ({
        ...jobs[0]!,
        id: `active-${id}`,
        key: `active-${id}`,
        status: 'queued',
        failure: null,
        createdAt: newsletterNow,
      }))
    );
    requireOk(
      await repository.mutate('ws-1', () =>
        Result.Ok({ value: 'queued', jobs })
      )
    );
    const summaries = requireOk(await repository.listJobSummaries('ws-1'));
    expect(summaries.slice(0, 2).map((job) => job.id)).toEqual([
      'active-a',
      'active-b',
    ]);
    expect(
      summaries
        .filter((job) => job.status === 'failed')
        .slice(0, 5)
        .map((job) => job.id)
    ).toEqual(['failed-7', 'failed-6', 'failed-5', 'failed-4', 'failed-3']);
  });
  it('allows only one of two distinct hosted and local jobs in a workspace to execute', async () => {
    const repository = createNewsletterRepository(database.db);
    const jobs = ['local', 'hosted'].map((mode): NewsletterJob => ({
      id: mode,
      key: mode,
      workspaceId: 'ws-1',
      kind: 'prepare',
      runtime:
        mode === 'local'
          ? newsletterProfile.runtime
          : { mode: 'hosted', provider: 'openai', model: 'gpt-5-mini' },
      localOperatorId: mode === 'local' ? 'reader' : null,
      selectionId: null,
      feedback: '',
      status: 'queued',
      stage: 'queued',
      checkpoint: {},
      leaseToken: null,
      leaseUntil: null,
      failure: null,
      createdAt: newsletterNow,
    }));
    requireOk(
      await repository.mutate('ws-1', () =>
        Result.Ok({ value: 'queued', jobs })
      )
    );
    const outcomes = (
      await Promise.all([
        repository.claim(
          'local',
          new Date('2090-01-01'),
          'local-token',
          'reader'
        ),
        repository.claim('hosted', new Date('1990-01-01'), 'hosted-token'),
      ])
    ).map(requireOk);
    expect(
      outcomes.filter((result) => result.type === 'job_claimed')
    ).toHaveLength(1);
    expect(
      outcomes.filter((result) => result.type === 'queue_empty')
    ).toHaveLength(1);
    const claimed = outcomes.find((result) => result.type === 'job_claimed')!;
    if (claimed.type !== 'job_claimed')
      throw new Error('Expected a claimed job');
    expect(
      requireOk(
        await repository.checkpoint(
          claimed.job,
          { status: 'succeeded' },
          claimed.job.leaseToken!
        )
      ).type
    ).toBe('job_updated');
    const mode = claimed.job.runtime.mode === 'local' ? 'hosted' : 'local';
    expect(
      requireOk(await repository.claim(mode, new Date(), 'next', 'reader')).type
    ).toBe('job_claimed');
  });
  it('serializes competing selections and enqueues their job atomically', async () => {
    const repository = createNewsletterRepository(database.db);
    await repository.mutate('ws-1', (state) => {
      Object.assign(state, stateFixture());
      return Result.Ok({ value: { type: 'initialized' as const } });
    });
    const select = () =>
      repository.mutate<{ type: 'selected' | 'conflict' }>('ws-1', (state) => {
        if (state.selections.length)
          return Result.Ok({ value: { type: 'conflict' } });
        state.selections.push({
          id: 'selected',
          reportId: 'report-1',
          angleId: 'angle-1',
          selectedAt: newsletterNow.toISOString(),
          snoozedUntil: newsletterNow.toISOString(),
          status: 'pending',
          selectedBy: 'reader',
          overrideReason: '',
          evidenceIdentities: [],
        });
        const job: NewsletterJob = {
          id: 'job',
          key: 'job',
          workspaceId: 'ws-1',
          kind: 'draft',
          runtime: newsletterProfile.runtime,
          selectionId: 'selected',
          feedback: '',
          status: 'queued',
          stage: 'queued',
          checkpoint: {},
          leaseToken: null,
          leaseUntil: null,
          failure: null,
          createdAt: newsletterNow,
        };
        return Result.Ok({ value: { type: 'selected' }, jobs: [job] });
      });
    expect(
      (await Promise.all([select(), select()]))
        .map((r) => requireOk(r).type)
        .sort()
    ).toEqual(['conflict', 'selected']);
    expect(requireOk(await repository.listJobs('ws-1'))).toHaveLength(1);
  });
  it('pins runtime, excludes active leases, and resumes saved checkpoints after lease expiry', async () => {
    const repository = createNewsletterRepository(database.db);
    const job: NewsletterJob = {
      id: 'job',
      key: 'job',
      workspaceId: 'ws-1',
      kind: 'prepare',
      runtime: newsletterProfile.runtime,
      localOperatorId: 'reader',
      selectionId: null,
      feedback: '',
      status: 'queued',
      stage: 'queued',
      checkpoint: {},
      leaseToken: null,
      leaseUntil: null,
      failure: null,
      createdAt: newsletterNow,
    };
    await repository.mutate('ws-1', () =>
      Result.Ok({ value: { type: 'queued' }, jobs: [job, job] })
    );
    expect(
      requireOk(await repository.claim('hosted', newsletterNow, 'hosted')).type
    ).toBe('queue_empty');
    expect(
      requireOk(
        await repository.claim('local', newsletterNow, 'wrong', 'another-user')
      ).type
    ).toBe('queue_empty');
    const lease = requireOk(
      await repository.claim('local', newsletterNow, 'first', 'reader')
    );
    if (lease.type !== 'job_claimed') throw new Error('Expected lease');
    expect(lease.job.leaseUntil!.getTime() - Date.now()).toBeGreaterThan(
      110000
    );
    const staleMutation = await repository.mutate(
      'other-workspace',
      () => Result.Ok({ value: 'bad' }),
      { jobId: lease.job.id, leaseToken: 'first' }
    );
    expect(staleMutation.isError()).toBe(true);
    await repository.checkpoint(
      lease.job,
      { stage: 'auditing', checkpoint: { repairs: 1 } },
      'first'
    );
    expect(
      requireOk(
        await repository.claim('local', newsletterNow, 'second', 'reader')
      ).type
    ).toBe('queue_empty');
    await database.db
      .update(newsletterJob)
      .set({ leaseUntil: sql`clock_timestamp() - interval '1 second'` });
    const resumed = requireOk(
      await repository.claim(
        'local',
        new Date(newsletterNow.getTime() + 180000),
        'second',
        'reader'
      )
    );
    expect(resumed).toMatchObject({
      type: 'job_claimed',
      job: { stage: 'auditing', checkpoint: { repairs: 1 } },
    });
    expect(
      (
        await repository.mutate('ws-1', () => Result.Ok({ value: 'stale' }), {
          jobId: lease.job.id,
          leaseToken: 'first',
        })
      ).isError()
    ).toBe(true);
    expect(
      requireOk(
        await repository.checkpoint(lease.job, { status: 'succeeded' }, 'first')
      ).type
    ).toBe('lease_lost');
  });
});
