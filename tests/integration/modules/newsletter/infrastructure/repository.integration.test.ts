import { Result } from '@swan-io/boxed';
import { createPgliteTestDatabase } from '@tests/server/pglite';
import {
  newsletterNow,
  newsletterProfile,
  requireOk,
  stateFixture,
} from '@tests/support/newsletter';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { workspace } from '@/modules/intelligence/infrastructure/drizzle/schema';
import type { NewsletterJob } from '@/modules/newsletter';
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
    const lease = requireOk(
      await repository.claim('local', newsletterNow, 'first')
    );
    if (lease.type !== 'job_claimed') throw new Error('Expected lease');
    await repository.checkpoint(
      lease.job,
      { stage: 'auditing', checkpoint: { repairs: 1 } },
      'first'
    );
    expect(
      requireOk(await repository.claim('local', newsletterNow, 'second')).type
    ).toBe('queue_empty');
    const resumed = requireOk(
      await repository.claim(
        'local',
        new Date(newsletterNow.getTime() + 180000),
        'second'
      )
    );
    expect(resumed).toMatchObject({
      type: 'job_claimed',
      job: { stage: 'auditing', checkpoint: { repairs: 1 } },
    });
    expect(
      requireOk(
        await repository.checkpoint(lease.job, { status: 'succeeded' }, 'first')
      ).type
    ).toBe('lease_lost');
  });
});
