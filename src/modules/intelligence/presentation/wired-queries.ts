import {
  createIntelligenceQueries,
  type IntelligenceQueryFacade,
} from './queries';
import {
  intelligenceGetLatestReport,
  intelligenceGetReport,
  intelligenceGetReportSources,
  intelligenceGetSource,
  intelligenceGetWorkspaceConfig,
  intelligenceListProviderCallbacks,
  intelligenceListReports,
  intelligenceListWorkspaces,
  intelligenceRecordFeedback,
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
  intelligenceRecordFeedback,
} satisfies IntelligenceQueryFacade);
