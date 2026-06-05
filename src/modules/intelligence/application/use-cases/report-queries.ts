import { Result } from '@swan-io/boxed';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import type {
  UserId,
  WeeklyReportId,
  WorkspaceId,
} from '@/modules/kernel/domain/ids';

import { isAllowed } from './permission';
import type { ForbiddenOutcome, IntelligenceUseCaseDeps } from './types';
import type {
  ReportGetOutcome,
  ReportLatestOutcome,
} from '../ports/report-repository';
import type {
  ReportSourceLink,
  WeeklyReport,
  WeeklyReportSummary,
} from '../../domain/report';

export type GetLatestReportInput = {
  currentUserId: UserId;
  workspaceId: WorkspaceId;
};

export async function getLatestReport(
  deps: IntelligenceUseCaseDeps,
  input: GetLatestReportInput
): Promise<ApplicationResult<ReportLatestOutcome | ForbiddenOutcome>> {
  const allowed = await isAllowed(deps.permissionChecker, input.currentUserId, {
    report: ['read'],
  });
  if (allowed.isError()) return Result.Error(allowed.getError());
  if (!allowed.get()) return Result.Ok({ type: 'forbidden' });

  return deps.reportRepository.getLatestPublished(input.workspaceId);
}

export type LatestReportForUserOutcome =
  | { type: 'report_ready'; report: WeeklyReport; workspaceId: WorkspaceId }
  | { type: 'no_report'; workspaceId: WorkspaceId | null };

export type GetLatestReportForUserInput = { currentUserId: UserId };

/** Resolve the current user's default workspace and its latest published report. */
export async function getLatestReportForUser(
  deps: IntelligenceUseCaseDeps,
  input: GetLatestReportForUserInput
): Promise<ApplicationResult<LatestReportForUserOutcome | ForbiddenOutcome>> {
  const allowed = await isAllowed(deps.permissionChecker, input.currentUserId, {
    report: ['read'],
  });
  if (allowed.isError()) return Result.Error(allowed.getError());
  if (!allowed.get()) return Result.Ok({ type: 'forbidden' });

  const workspaces = await deps.workspaceRepository.list();
  if (workspaces.isError()) return Result.Error(workspaces.getError());

  const workspace = workspaces.get()[0];
  if (!workspace) return Result.Ok({ type: 'no_report', workspaceId: null });

  const latest = await deps.reportRepository.getLatestPublished(workspace.id);
  if (latest.isError()) return Result.Error(latest.getError());

  const outcome = latest.get();
  if (outcome.type === 'report_found') {
    return Result.Ok({
      type: 'report_ready',
      report: outcome.report,
      workspaceId: workspace.id,
    });
  }
  return Result.Ok({ type: 'no_report', workspaceId: workspace.id });
}

export type GetReportInput = {
  currentUserId: UserId;
  reportId: WeeklyReportId;
};

export async function getReport(
  deps: IntelligenceUseCaseDeps,
  input: GetReportInput
): Promise<ApplicationResult<ReportGetOutcome | ForbiddenOutcome>> {
  const allowed = await isAllowed(deps.permissionChecker, input.currentUserId, {
    report: ['read'],
  });
  if (allowed.isError()) return Result.Error(allowed.getError());
  if (!allowed.get()) return Result.Ok({ type: 'forbidden' });

  return deps.reportRepository.getById(input.reportId);
}

export type ListReportsOutcome =
  | { type: 'reports_listed'; reports: WeeklyReportSummary[] }
  | ForbiddenOutcome;

export type ListReportsInput = {
  currentUserId: UserId;
  workspaceId: WorkspaceId;
  limit?: number;
};

export async function listReports(
  deps: IntelligenceUseCaseDeps,
  input: ListReportsInput
): Promise<ApplicationResult<ListReportsOutcome>> {
  const allowed = await isAllowed(deps.permissionChecker, input.currentUserId, {
    report: ['read'],
  });
  if (allowed.isError()) return Result.Error(allowed.getError());
  if (!allowed.get()) return Result.Ok({ type: 'forbidden' });

  const result = await deps.reportRepository.listByWorkspace(
    input.workspaceId,
    { limit: input.limit }
  );
  if (result.isError()) return Result.Error(result.getError());
  return Result.Ok({ type: 'reports_listed', reports: result.get() });
}

export type ListReportSourcesOutcome =
  | { type: 'report_sources_listed'; sources: ReportSourceLink[] }
  | ForbiddenOutcome;

export type ListReportSourcesInput = {
  currentUserId: UserId;
  reportId: WeeklyReportId;
};

export async function listReportSources(
  deps: IntelligenceUseCaseDeps,
  input: ListReportSourcesInput
): Promise<ApplicationResult<ListReportSourcesOutcome>> {
  const allowed = await isAllowed(deps.permissionChecker, input.currentUserId, {
    report: ['read'],
  });
  if (allowed.isError()) return Result.Error(allowed.getError());
  if (!allowed.get()) return Result.Ok({ type: 'forbidden' });

  const result = await deps.reportRepository.listSources(input.reportId);
  if (result.isError()) return Result.Error(result.getError());
  return Result.Ok({ type: 'report_sources_listed', sources: result.get() });
}
