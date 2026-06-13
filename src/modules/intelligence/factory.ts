import { listProviderCallbacks } from './application/use-cases/ingestion-queries';
import { labelSource } from './application/use-cases/label-source';
import {
  getLatestReport,
  getLatestReportForUser,
  getReport,
  listReports,
  listReportSources,
} from './application/use-cases/report-queries';
import {
  getReportRubricScore,
  scoreReport,
} from './application/use-cases/score-report';
import { getSourceRecord } from './application/use-cases/source-queries';
import type { IntelligenceUseCaseDeps } from './application/use-cases/types';
import {
  createWorkspace,
  updateWorkspace,
} from './application/use-cases/workspace-commands';
import {
  getWorkspaceConfig,
  listWorkspaces,
} from './application/use-cases/workspace-queries';

export function createIntelligenceUseCases(deps: IntelligenceUseCaseDeps) {
  return {
    getLatestReport: (input: Parameters<typeof getLatestReport>[1]) =>
      getLatestReport(deps, input),
    getLatestReportForUser: (
      input: Parameters<typeof getLatestReportForUser>[1]
    ) => getLatestReportForUser(deps, input),
    getReport: (input: Parameters<typeof getReport>[1]) =>
      getReport(deps, input),
    listReports: (input: Parameters<typeof listReports>[1]) =>
      listReports(deps, input),
    listReportSources: (input: Parameters<typeof listReportSources>[1]) =>
      listReportSources(deps, input),
    getSourceRecord: (input: Parameters<typeof getSourceRecord>[1]) =>
      getSourceRecord(deps, input),
    listWorkspaces: (input: Parameters<typeof listWorkspaces>[1]) =>
      listWorkspaces(deps, input),
    getWorkspaceConfig: (input: Parameters<typeof getWorkspaceConfig>[1]) =>
      getWorkspaceConfig(deps, input),
    createWorkspace: (input: Parameters<typeof createWorkspace>[1]) =>
      createWorkspace(deps, input),
    updateWorkspace: (input: Parameters<typeof updateWorkspace>[1]) =>
      updateWorkspace(deps, input),
    scoreReport: (input: Parameters<typeof scoreReport>[1]) =>
      scoreReport(deps, input),
    getReportRubricScore: (input: Parameters<typeof getReportRubricScore>[1]) =>
      getReportRubricScore(deps, input),
    labelSource: (input: Parameters<typeof labelSource>[1]) =>
      labelSource(deps, input),
    listProviderCallbacks: (
      input: Parameters<typeof listProviderCallbacks>[1]
    ) => listProviderCallbacks(deps, input),
  };
}

export type IntelligenceUseCases = ReturnType<
  typeof createIntelligenceUseCases
>;
