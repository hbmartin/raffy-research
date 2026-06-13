/* oxlint-disable @tanstack/query/exhaustive-deps -- Query factories inject a stable facade; facade identity is not a cache-key dimension. */
import { queryOptions } from '@tanstack/react-query';

import { serverMutationOptions } from '@/platform/lib/tanstack-query/scoped-query-options';
import type { ServerFunctionFacade } from '@/platform/lib/tanstack-start/server-function-types';

import type {
  SourceRecordId,
  WeeklyReportId,
  WorkspaceId,
} from '@/modules/kernel/domain/ids';

import type { IntelligenceServerFunctions } from '../server';

export type IntelligenceQueryFacade = ServerFunctionFacade<
  Pick<
    IntelligenceServerFunctions,
    | 'intelligenceGetLatestReport'
    | 'intelligenceGetReport'
    | 'intelligenceGetReportSources'
    | 'intelligenceGetSource'
    | 'intelligenceGetWorkspaceConfig'
    | 'intelligenceListReports'
    | 'intelligenceListWorkspaces'
    | 'intelligenceListProviderCallbacks'
    | 'intelligenceScoreReport'
    | 'intelligenceGetReportScore'
    | 'intelligenceLabelSource'
  >
>;

const intelligenceQueryVersion = 'v1';

export const createIntelligenceQueries = <
  TFacade extends IntelligenceQueryFacade,
>(
  facade: TFacade
) => ({
  latestReport: () =>
    queryOptions({
      queryKey: ['intelligence', intelligenceQueryVersion, 'latestReport'],
      queryFn: () => facade.intelligenceGetLatestReport(),
    }),
  report: (reportId: WeeklyReportId) =>
    queryOptions({
      queryKey: ['intelligence', intelligenceQueryVersion, 'report', reportId],
      queryFn: () => facade.intelligenceGetReport({ data: { reportId } }),
    }),
  reportSources: (reportId: WeeklyReportId) =>
    queryOptions({
      queryKey: [
        'intelligence',
        intelligenceQueryVersion,
        'reportSources',
        reportId,
      ],
      queryFn: () =>
        facade.intelligenceGetReportSources({ data: { reportId } }),
    }),
  source: (sourceId: SourceRecordId) =>
    queryOptions({
      queryKey: ['intelligence', intelligenceQueryVersion, 'source', sourceId],
      queryFn: () => facade.intelligenceGetSource({ data: { sourceId } }),
    }),
  workspaces: () =>
    queryOptions({
      queryKey: ['intelligence', intelligenceQueryVersion, 'workspaces'],
      queryFn: () => facade.intelligenceListWorkspaces(),
    }),
  workspaceConfig: (workspaceId: WorkspaceId) =>
    queryOptions({
      queryKey: [
        'intelligence',
        intelligenceQueryVersion,
        'workspaceConfig',
        workspaceId,
      ],
      queryFn: () =>
        facade.intelligenceGetWorkspaceConfig({ data: { workspaceId } }),
    }),
  reportsByWorkspace: (workspaceId: WorkspaceId) =>
    queryOptions({
      queryKey: [
        'intelligence',
        intelligenceQueryVersion,
        'reportsByWorkspace',
        workspaceId,
      ],
      queryFn: () => facade.intelligenceListReports({ data: { workspaceId } }),
    }),
  providerCallbacks: (workspaceId: WorkspaceId, limit?: number) =>
    queryOptions({
      queryKey: [
        'intelligence',
        intelligenceQueryVersion,
        'providerCallbacks',
        workspaceId,
        limit,
      ],
      queryFn: () =>
        facade.intelligenceListProviderCallbacks({
          data: { workspaceId, limit },
        }),
    }),
  reportScore: (reportId: WeeklyReportId) =>
    queryOptions({
      queryKey: [
        'intelligence',
        intelligenceQueryVersion,
        'reportScore',
        reportId,
      ],
      queryFn: () => facade.intelligenceGetReportScore({ data: { reportId } }),
    }),
  scoreReport: () =>
    serverMutationOptions({
      mutationKey: ['intelligence', intelligenceQueryVersion, 'scoreReport'],
      mutationFn: facade.intelligenceScoreReport,
    }),
  labelSource: () =>
    serverMutationOptions({
      mutationKey: ['intelligence', intelligenceQueryVersion, 'labelSource'],
      mutationFn: facade.intelligenceLabelSource,
    }),
});

export type IntelligenceQueries = ReturnType<typeof createIntelligenceQueries>;
