export * from './common';
export * from './relations';
export * from '@/modules/auth/infrastructure/drizzle/schema';
export * from '@/modules/email/infrastructure/drizzle/schema';
export * from '@/modules/intelligence/infrastructure/drizzle/schema';

import {
  account,
  authIdentity,
  session,
  user,
  verification,
} from '@/modules/auth/infrastructure/drizzle/schema';
import { emailStatus } from '@/modules/email/infrastructure/drizzle/schema';
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

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;
export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;
export type AuthIdentity = typeof authIdentity.$inferSelect;
export type NewAuthIdentity = typeof authIdentity.$inferInsert;
export type Verification = typeof verification.$inferSelect;
export type NewVerification = typeof verification.$inferInsert;
export type EmailStatus = typeof emailStatus.$inferSelect;
export type NewEmailStatus = typeof emailStatus.$inferInsert;
export type Workspace = typeof workspace.$inferSelect;
export type NewWorkspace = typeof workspace.$inferInsert;
export type WorkspaceKeyword = typeof workspaceKeyword.$inferSelect;
export type NewWorkspaceKeyword = typeof workspaceKeyword.$inferInsert;
export type WorkspaceSocialAccount = typeof workspaceSocialAccount.$inferSelect;
export type NewWorkspaceSocialAccount =
  typeof workspaceSocialAccount.$inferInsert;
export type WorkspaceCompetitor = typeof workspaceCompetitor.$inferSelect;
export type NewWorkspaceCompetitor = typeof workspaceCompetitor.$inferInsert;
export type ProviderConfig = typeof providerConfig.$inferSelect;
export type NewProviderConfig = typeof providerConfig.$inferInsert;
export type InternalNoteConfig = typeof internalNoteConfig.$inferSelect;
export type NewInternalNoteConfig = typeof internalNoteConfig.$inferInsert;
export type SourceRecord = typeof sourceRecord.$inferSelect;
export type NewSourceRecord = typeof sourceRecord.$inferInsert;
export type SearchResult = typeof searchResult.$inferSelect;
export type NewSearchResult = typeof searchResult.$inferInsert;
export type SourceSummary = typeof sourceSummary.$inferSelect;
export type NewSourceSummary = typeof sourceSummary.$inferInsert;
export type WeeklyReport = typeof weeklyReport.$inferSelect;
export type NewWeeklyReport = typeof weeklyReport.$inferInsert;
export type WeeklyReportSource = typeof weeklyReportSource.$inferSelect;
export type NewWeeklyReportSource = typeof weeklyReportSource.$inferInsert;
export type FeedbackEvent = typeof feedbackEvent.$inferSelect;
export type NewFeedbackEvent = typeof feedbackEvent.$inferInsert;
export type IngestionRun = typeof ingestionRun.$inferSelect;
export type NewIngestionRun = typeof ingestionRun.$inferInsert;
export type ProviderCallbackEvent = typeof providerCallbackEvent.$inferSelect;
export type NewProviderCallbackEvent =
  typeof providerCallbackEvent.$inferInsert;
