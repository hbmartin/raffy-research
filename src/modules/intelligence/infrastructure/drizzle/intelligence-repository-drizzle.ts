import { and, desc, eq, gte, lt } from 'drizzle-orm';

import {
  type FeedbackEvent,
  feedbackEvent,
  ingestionRun,
  type NewFeedbackEvent,
  type NewIngestionRun,
  type NewProviderCallbackEvent,
  type NewSearchResult,
  type NewSourceRecord,
  type NewSourceSummary,
  type NewWeeklyReport,
  type NewWeeklyReportSource,
  type NewWorkspace,
  type NewWorkspaceCompetitor,
  type NewWorkspaceKeyword,
  type NewWorkspaceSocialAccount,
  type ProviderCallbackEvent,
  providerCallbackEvent,
  type ProviderConfig,
  providerConfig,
  type SearchResult,
  searchResult,
  type SourceRecord,
  sourceRecord,
  type SourceSummary,
  sourceSummary,
  type WeeklyReport,
  weeklyReport,
  weeklyReportSource,
  type Workspace,
  workspace,
  type WorkspaceCompetitor,
  workspaceCompetitor,
  type WorkspaceKeyword,
  workspaceKeyword,
  type WorkspaceSocialAccount,
  workspaceSocialAccount,
} from '@/modules/kernel/infrastructure/db/schema';
import type { DbLike } from '@/modules/kernel/infrastructure/db/types';

import type {
  IntelligenceRepository,
  ReportWithSources,
  WorkspaceConfiguration,
} from '../../application/ports/intelligence-repository';

const first = <T>(rows: T[]) => rows[0];

export function createIntelligenceRepository(options: {
  db: DbLike;
}): IntelligenceRepository {
  const { db } = options;

  return {
    async createWorkspace(input: NewWorkspace): Promise<Workspace> {
      return first(await db.insert(workspace).values(input).returning())!;
    },
    async addWorkspaceKeyword(
      input: NewWorkspaceKeyword
    ): Promise<WorkspaceKeyword> {
      return first(
        await db.insert(workspaceKeyword).values(input).returning()
      )!;
    },
    async addWorkspaceSocialAccount(
      input: NewWorkspaceSocialAccount
    ): Promise<WorkspaceSocialAccount> {
      return first(
        await db.insert(workspaceSocialAccount).values(input).returning()
      )!;
    },
    async addWorkspaceCompetitor(
      input: NewWorkspaceCompetitor
    ): Promise<WorkspaceCompetitor> {
      return first(
        await db.insert(workspaceCompetitor).values(input).returning()
      )!;
    },
    listWorkspaces(): Promise<Workspace[]> {
      return db.select().from(workspace).orderBy(desc(workspace.createdAt));
    },
    async getWorkspaceConfiguration(
      workspaceId: string
    ): Promise<WorkspaceConfiguration | null> {
      const found = await db.query.workspace.findFirst({
        where: eq(workspace.id, workspaceId),
        with: {
          keywords: true,
          socialAccounts: true,
          competitors: true,
          providerConfigs: true,
        },
      });
      if (!found) return null;

      return {
        workspace: found,
        keywords: found.keywords,
        socialAccounts: found.socialAccounts,
        competitors: found.competitors,
        providers: found.providerConfigs,
      };
    },
    listEnabledProviderConfigs(workspaceId: string): Promise<ProviderConfig[]> {
      return db.query.providerConfig.findMany({
        where: and(
          eq(providerConfig.workspaceId, workspaceId),
          eq(providerConfig.enabled, true)
        ),
      });
    },
    async insertSourceRecord(input: NewSourceRecord): Promise<SourceRecord> {
      return first(await db.insert(sourceRecord).values(input).returning())!;
    },
    async insertSearchResult(input: NewSearchResult): Promise<SearchResult> {
      return first(await db.insert(searchResult).values(input).returning())!;
    },
    async insertSourceSummary(input: NewSourceSummary): Promise<SourceSummary> {
      return first(await db.insert(sourceSummary).values(input).returning())!;
    },
    async insertProviderCallbackEvent(
      input: NewProviderCallbackEvent
    ): Promise<ProviderCallbackEvent> {
      return first(
        await db.insert(providerCallbackEvent).values(input).returning()
      )!;
    },
    listProviderCallbackEvents(input = {}): Promise<ProviderCallbackEvent[]> {
      return db.query.providerCallbackEvent.findMany({
        limit: input.limit ?? 20,
        orderBy: [desc(providerCallbackEvent.receivedAt)],
        where: input.workspaceId
          ? eq(providerCallbackEvent.workspaceId, input.workspaceId)
          : undefined,
      });
    },
    async updateProviderCallbackEvent(
      id: string,
      input: Partial<NewProviderCallbackEvent>
    ): Promise<ProviderCallbackEvent | null> {
      return (
        first(
          await db
            .update(providerCallbackEvent)
            .set({ ...input, updatedAt: new Date() })
            .where(eq(providerCallbackEvent.id, id))
            .returning()
        ) ?? null
      );
    },
    async insertIngestionRun(input: NewIngestionRun): Promise<void> {
      await db.insert(ingestionRun).values(input);
    },
    async findReportByPeriod(input: {
      workspaceId: string;
      periodStart: Date;
      periodEnd: Date;
    }): Promise<WeeklyReport | null> {
      return (
        (await db.query.weeklyReport.findFirst({
          where: and(
            eq(weeklyReport.workspaceId, input.workspaceId),
            eq(weeklyReport.periodStart, input.periodStart),
            eq(weeklyReport.periodEnd, input.periodEnd)
          ),
        })) ?? null
      );
    },
    listSourceRecordsForPeriod(input: {
      workspaceId: string;
      periodStart: Date;
      periodEnd: Date;
    }): Promise<SourceRecord[]> {
      return db.query.sourceRecord.findMany({
        where: and(
          eq(sourceRecord.workspaceId, input.workspaceId),
          gte(sourceRecord.capturedAt, input.periodStart),
          lt(sourceRecord.capturedAt, input.periodEnd)
        ),
        orderBy: [desc(sourceRecord.capturedAt)],
      });
    },
    async insertWeeklyReport(input: NewWeeklyReport): Promise<WeeklyReport> {
      return first(await db.insert(weeklyReport).values(input).returning())!;
    },
    async updateWeeklyReport(
      id: string,
      input: Partial<NewWeeklyReport>
    ): Promise<WeeklyReport | null> {
      return (
        first(
          await db
            .update(weeklyReport)
            .set({ ...input, updatedAt: new Date() })
            .where(eq(weeklyReport.id, id))
            .returning()
        ) ?? null
      );
    },
    async insertWeeklyReportSources(
      inputs: NewWeeklyReportSource[]
    ): Promise<void> {
      if (!inputs.length) return;
      await db.insert(weeklyReportSource).values(inputs);
    },
    async getLatestPublishedReport(
      workspaceId: string
    ): Promise<WeeklyReport | null> {
      return (
        (await db.query.weeklyReport.findFirst({
          where: and(
            eq(weeklyReport.workspaceId, workspaceId),
            eq(weeklyReport.status, 'published')
          ),
          orderBy: [desc(weeklyReport.periodStart)],
        })) ?? null
      );
    },
    async getReportWithSources(
      reportId: string
    ): Promise<ReportWithSources | null> {
      const report = await db.query.weeklyReport.findFirst({
        where: eq(weeklyReport.id, reportId),
      });
      if (!report) return null;

      const sources = await db.query.weeklyReportSource.findMany({
        where: eq(weeklyReportSource.reportId, reportId),
        with: { sourceRecord: true },
      });
      return { report, sources };
    },
    async getSourceRecord(
      sourceRecordId: string
    ): Promise<SourceRecord | null> {
      return (
        (await db.query.sourceRecord.findFirst({
          where: eq(sourceRecord.id, sourceRecordId),
        })) ?? null
      );
    },
    async recordFeedback(input: NewFeedbackEvent): Promise<FeedbackEvent> {
      return first(await db.insert(feedbackEvent).values(input).returning())!;
    },
    async acceptSuggestedCompetitor(input: {
      workspaceId: string;
      competitorId: string;
    }): Promise<WorkspaceCompetitor | null> {
      return (
        first(
          await db
            .update(workspaceCompetitor)
            .set({ state: 'accepted', updatedAt: new Date() })
            .where(
              and(
                eq(workspaceCompetitor.workspaceId, input.workspaceId),
                eq(workspaceCompetitor.id, input.competitorId)
              )
            )
            .returning()
        ) ?? null
      );
    },
  };
}
