import {
  createIntelligenceQueries,
  type IntelligenceQueryFacade,
} from './queries';
import {
  intelligenceGetLatestReport,
  intelligenceGetReport,
  intelligenceGetReportScore,
  intelligenceGetReportSources,
  intelligenceGetSource,
  intelligenceGetWorkspaceConfig,
  intelligenceLabelSource,
  intelligenceListProviderCallbacks,
  intelligenceListReports,
  intelligenceListScheduledJobs,
  intelligenceListWorkspaces,
  intelligenceScoreReport,
} from '../server';

export const intelligenceQueries = createIntelligenceQueries({
  intelligenceGetLatestReport,
  intelligenceGetReport,
  intelligenceGetReportSources,
  intelligenceGetSource,
  intelligenceGetWorkspaceConfig,
  intelligenceListReports,
  intelligenceListWorkspaces,
  intelligenceListProviderCallbacks,
  intelligenceListScheduledJobs,
  intelligenceScoreReport,
  intelligenceGetReportScore,
  intelligenceLabelSource,
} satisfies IntelligenceQueryFacade);
