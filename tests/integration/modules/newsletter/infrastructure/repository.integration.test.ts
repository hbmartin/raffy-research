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
