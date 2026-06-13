import { Result } from '@swan-io/boxed';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import type {
  SourceRecordId,
  UserId,
  WorkspaceId,
} from '@/modules/kernel/domain/ids';

import { isAllowed } from './permission';
import type { ForbiddenOutcome, IntelligenceUseCaseDeps } from './types';
import { sourceBelongsToWorkspace } from './workspace-ownership';
import type { SourceLabelOutcome } from '../ports/source-repository';
import type { SourceRelevanceLabel } from '../../domain/source';

export type LabelSourceInput = {
  currentUserId: UserId;
  workspaceId: WorkspaceId;
  sourceRecordId: SourceRecordId;
  /** null clears the label back to unreviewed. */
  label: SourceRelevanceLabel | null;
};

/**
 * Marks an ingested source keep/junk. Junk sources are excluded from report
 * generation input; the labels also measure acquisition quality over time.
 */
export async function labelSource(
  deps: IntelligenceUseCaseDeps,
  input: LabelSourceInput
): Promise<ApplicationResult<SourceLabelOutcome | ForbiddenOutcome>> {
  const allowed = await isAllowed(deps.permissionChecker, input.currentUserId, {
    source: ['label'],
  });
  if (allowed.isError()) return Result.Error(allowed.getError());
  if (!allowed.get()) return Result.Ok({ type: 'forbidden' });

  const matchesWorkspace = await sourceBelongsToWorkspace(
    deps,
    input.sourceRecordId,
    input.workspaceId
  );
  if (matchesWorkspace.isError())
    return Result.Error(matchesWorkspace.getError());
  if (matchesWorkspace.get().type === 'not_in_workspace') {
    return Result.Ok({ type: 'forbidden' });
  }

  return deps.sourceRepository.setRelevanceLabel({
    workspaceId: input.workspaceId,
    sourceRecordId: input.sourceRecordId,
    label: input.label,
    labeledAt: deps.clock.now(),
  });
}
