import { Result } from '@swan-io/boxed';
import {
  archiveFixture,
  memoryRepository,
  newsletterIds,
  newsletterNow,
  requireOk,
  stateFixture,
} from '@tests/support/newsletter';
import { describe, expect, it } from 'vitest';

import { toUserId } from '@/modules/kernel';
import {
  createNewsletterUseCases,
  rankThemes,
} from '@/modules/newsletter/testing';

const actor = {
  userId: toUserId('reader'),
  workspaceId: 'ws-1',
  reportId: 'report-1',
};
describe('Preparation-scoped individual angle skips', () => {
  it('hides one offered angle, preserves the rest, and rejects selecting it until unskipped', async () => {
    const initial = stateFixture();
    initial.angles.push({
      ...initial.angles[0]!,
      id: 'angle-2',
      title: 'Another connection',
    });
    initial.offers = rankThemes(initial, newsletterNow);
    const memory = memoryRepository(initial);
    const useCases = createNewsletterUseCases({
      repository: memory.repository,
      archive: archiveFixture,
      permissionChecker: {
        hasPermission: async () =>
          Result.Ok({ type: 'permission_granted' as const }),
      },
      clock: { now: () => newsletterNow },
      idGenerator: newsletterIds(),
    });
    expect(
      requireOk(
        await useCases.skipAngle({ ...actor, angleId: 'angle-1', skip: true })
      ).type
    ).toBe('saved');
    const view = requireOk(await useCases.get(actor));
    expect(view.type).toBe('newsletter_found');
    if (view.type === 'newsletter_found')
      expect(view.state.offers.map((offer) => offer.id)).toEqual(['angle-2']);
    expect(
      requireOk(await useCases.select({ ...actor, angleId: 'angle-1' })).type
    ).toBe('angle_unavailable');
    expect(
      requireOk(
        await useCases.skipAngle({ ...actor, angleId: 'missing', skip: true })
      ).type
    ).toBe('angle_unavailable');
    expect(
      requireOk(
        await useCases.skipAngle({ ...actor, angleId: 'angle-1', skip: false })
      ).type
    ).toBe('saved');
    expect(
      requireOk(await useCases.select({ ...actor, angleId: 'angle-1' }))
    ).toMatchObject({
      type: 'queued',
      jobId: expect.any(String),
      selectionId: expect.any(String),
    });
  });
});
