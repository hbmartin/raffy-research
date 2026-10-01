import { Result } from '@swan-io/boxed';
import { describe, expect, it, vi } from 'vitest';

import type { IntelligenceUseCaseDeps } from '@/modules/intelligence';
import { listScheduledJobs } from '@/modules/intelligence/application/use-cases/scheduled-job-queries';
import { toUserId, toWorkspaceId } from '@/modules/kernel/domain/ids';

const input = {
  currentUserId: toUserId('user-1'),
  workspaceId: toWorkspaceId('ws-1'),
};

describe('scheduled job query authorization', () => {
  it('requires manager permission before reading run history', async () => {
    const listForWorkspace = vi.fn(async () => Result.Ok([]));
    const hasPermission = vi.fn(async () =>
      Result.Ok({ type: 'permission_denied' as const })
    );
    const deps = {
      permissionChecker: { hasPermission },
      scheduledJobRepository: { listForWorkspace },
    } as unknown as IntelligenceUseCaseDeps;
    const result = await listScheduledJobs(deps, input);
    if (result.isError()) throw result.getError();
    expect(result.get()).toEqual({ type: 'forbidden' });
    expect(hasPermission).toHaveBeenCalledWith(input.currentUserId, {
      apps: ['manager'],
    });
    expect(listForWorkspace).not.toHaveBeenCalled();
  });
});
