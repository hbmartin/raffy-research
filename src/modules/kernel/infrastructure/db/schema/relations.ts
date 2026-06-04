import { relations } from 'drizzle-orm';

import {
  account,
  authIdentity,
  session,
  user,
} from '@/modules/auth/infrastructure/drizzle/schema';
import {
  feedbackEvent,
  ingestionRun,
  internalNoteConfig,
  providerCallbackEvent,
  providerConfig,
  searchResult,
  sourceRecord,
  sourceSummary,
  weeklyReport,
  weeklyReportSource,
  workspace,
  workspaceCompetitor,
  workspaceKeyword,
  workspaceSocialAccount,
} from '@/modules/intelligence/infrastructure/drizzle/schema';

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  identities: many(authIdentity),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const authIdentityRelations = relations(authIdentity, ({ one }) => ({
  user: one(user, {
    fields: [authIdentity.userId],
    references: [user.id],
  }),
}));

export const workspaceRelations = relations(workspace, ({ many }) => ({
  keywords: many(workspaceKeyword),
  socialAccounts: many(workspaceSocialAccount),
  competitors: many(workspaceCompetitor),
  providerConfigs: many(providerConfig),
  internalNoteConfigs: many(internalNoteConfig),
  sourceRecords: many(sourceRecord),
  weeklyReports: many(weeklyReport),
  feedbackEvents: many(feedbackEvent),
  ingestionRuns: many(ingestionRun),
  providerCallbackEvents: many(providerCallbackEvent),
}));

export const workspaceKeywordRelations = relations(
  workspaceKeyword,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [workspaceKeyword.workspaceId],
      references: [workspace.id],
    }),
  })
);

export const workspaceSocialAccountRelations = relations(
  workspaceSocialAccount,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [workspaceSocialAccount.workspaceId],
      references: [workspace.id],
    }),
  })
);

export const workspaceCompetitorRelations = relations(
  workspaceCompetitor,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [workspaceCompetitor.workspaceId],
      references: [workspace.id],
    }),
  })
);

export const providerConfigRelations = relations(providerConfig, ({ one }) => ({
  workspace: one(workspace, {
    fields: [providerConfig.workspaceId],
    references: [workspace.id],
  }),
}));

export const internalNoteConfigRelations = relations(
  internalNoteConfig,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [internalNoteConfig.workspaceId],
      references: [workspace.id],
    }),
  })
);

export const sourceRecordRelations = relations(
  sourceRecord,
  ({ one, many }) => ({
    workspace: one(workspace, {
      fields: [sourceRecord.workspaceId],
      references: [workspace.id],
    }),
    searchResults: many(searchResult),
    sourceSummaries: many(sourceSummary),
    weeklyReportSources: many(weeklyReportSource),
    feedbackEvents: many(feedbackEvent),
  })
);

export const searchResultRelations = relations(searchResult, ({ one }) => ({
  workspace: one(workspace, {
    fields: [searchResult.workspaceId],
    references: [workspace.id],
  }),
  sourceRecord: one(sourceRecord, {
    fields: [searchResult.sourceRecordId],
    references: [sourceRecord.id],
  }),
}));

export const sourceSummaryRelations = relations(sourceSummary, ({ one }) => ({
  workspace: one(workspace, {
    fields: [sourceSummary.workspaceId],
    references: [workspace.id],
  }),
  sourceRecord: one(sourceRecord, {
    fields: [sourceSummary.sourceRecordId],
    references: [sourceRecord.id],
  }),
}));

export const weeklyReportRelations = relations(
  weeklyReport,
  ({ one, many }) => ({
    workspace: one(workspace, {
      fields: [weeklyReport.workspaceId],
      references: [workspace.id],
    }),
    reportSources: many(weeklyReportSource),
    feedbackEvents: many(feedbackEvent),
  })
);

export const weeklyReportSourceRelations = relations(
  weeklyReportSource,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [weeklyReportSource.workspaceId],
      references: [workspace.id],
    }),
    report: one(weeklyReport, {
      fields: [weeklyReportSource.reportId],
      references: [weeklyReport.id],
    }),
    sourceRecord: one(sourceRecord, {
      fields: [weeklyReportSource.sourceRecordId],
      references: [sourceRecord.id],
    }),
  })
);

export const feedbackEventRelations = relations(feedbackEvent, ({ one }) => ({
  workspace: one(workspace, {
    fields: [feedbackEvent.workspaceId],
    references: [workspace.id],
  }),
  report: one(weeklyReport, {
    fields: [feedbackEvent.reportId],
    references: [weeklyReport.id],
  }),
  sourceRecord: one(sourceRecord, {
    fields: [feedbackEvent.sourceRecordId],
    references: [sourceRecord.id],
  }),
}));

export const ingestionRunRelations = relations(ingestionRun, ({ one }) => ({
  workspace: one(workspace, {
    fields: [ingestionRun.workspaceId],
    references: [workspace.id],
  }),
}));

export const providerCallbackEventRelations = relations(
  providerCallbackEvent,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [providerCallbackEvent.workspaceId],
      references: [workspace.id],
    }),
  })
);
