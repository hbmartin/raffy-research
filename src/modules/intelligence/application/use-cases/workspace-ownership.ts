import { Result } from '@swan-io/boxed';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import type {
  SourceRecordId,
  WeeklyReportId,
  WorkspaceId,
} from '@/modules/kernel/domain/ids';

import type { IntelligenceUseCaseDeps } from './types';

export type WorkspaceOwnershipOutcome =
  | { type: 'belongs_to_workspace' }
  | { type: 'not_in_workspace' };

export async function reportBelongsToWorkspace(
  deps: Pick<IntelligenceUseCaseDeps, 'reportRepository'>,
  reportId: WeeklyReportId,
  workspaceId: WorkspaceId
): Promise<ApplicationResult<WorkspaceOwnershipOutcome>> {
  const report = await deps.reportRepository.getById(reportId);
  if (report.isError()) return Result.Error(report.getError());
  const reportOutcome = report.get();
  return Result.Ok(
    reportOutcome.type === 'report_found' &&
      reportOutcome.report.workspaceId === workspaceId
      ? { type: 'belongs_to_workspace' }
      : { type: 'not_in_workspace' }
  );
}

export async function sourceBelongsToWorkspace(
  deps: Pick<IntelligenceUseCaseDeps, 'sourceRepository'>,
  sourceRecordId: SourceRecordId,
  workspaceId: WorkspaceId
): Promise<ApplicationResult<WorkspaceOwnershipOutcome>> {
  const source = await deps.sourceRepository.getById(sourceRecordId);
  if (source.isError()) return Result.Error(source.getError());
  const sourceOutcome = source.get();
  return Result.Ok(
    sourceOutcome.type === 'source_record_found' &&
      sourceOutcome.sourceRecord.workspaceId === workspaceId
      ? { type: 'belongs_to_workspace' }
      : { type: 'not_in_workspace' }
  );
}
