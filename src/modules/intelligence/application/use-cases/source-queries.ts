import { Result } from '@swan-io/boxed';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import type { SourceRecordId, UserId } from '@/modules/kernel/domain/ids';

import { isAllowed } from './permission';
import type { ForbiddenOutcome, IntelligenceUseCaseDeps } from './types';
import type { SourceRecordGetOutcome } from '../ports/source-repository';

export type GetSourceRecordInput = {
  currentUserId: UserId;
  sourceRecordId: SourceRecordId;
};

export async function getSourceRecord(
  deps: IntelligenceUseCaseDeps,
  input: GetSourceRecordInput
): Promise<ApplicationResult<SourceRecordGetOutcome | ForbiddenOutcome>> {
  const allowed = await isAllowed(deps.permissionChecker, input.currentUserId, {
    report: ['read'],
  });
  if (allowed.isError()) return Result.Error(allowed.getError());
  if (!allowed.get()) return Result.Ok({ type: 'forbidden' });

  return deps.sourceRepository.getById(input.sourceRecordId);
}
