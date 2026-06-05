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
  intelligenceRecordFeedback,
} satisfies IntelligenceQueryFacade);
