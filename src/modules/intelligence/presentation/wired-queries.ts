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
  intelligenceScoreReport,
  intelligenceGetReportScore,
  intelligenceLabelSource,
} satisfies IntelligenceQueryFacade);
