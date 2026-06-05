DROP INDEX IF EXISTS "weeklyReport_workspace_period_idx";--> statement-breakpoint
ALTER TABLE "feedbackEvent" ALTER COLUMN "payload" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "feedbackEvent" ALTER COLUMN "payload" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "internalNoteConfig" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "internalNoteConfig" ALTER COLUMN "metadata" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "providerCallbackEvent" ALTER COLUMN "rawPayload" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "providerCallbackEvent" ALTER COLUMN "rawPayload" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "providerConfig" ALTER COLUMN "config" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "providerConfig" ALTER COLUMN "config" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "searchResult" ALTER COLUMN "rawPayload" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "searchResult" ALTER COLUMN "rawPayload" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "searchResult" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "searchResult" ALTER COLUMN "metadata" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sourceRecord" ALTER COLUMN "rawPayload" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "sourceRecord" ALTER COLUMN "rawPayload" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sourceRecord" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "sourceRecord" ALTER COLUMN "metadata" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sourceSummary" ALTER COLUMN "inputMetadata" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "sourceSummary" ALTER COLUMN "inputMetadata" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sourceSummary" ALTER COLUMN "outputPayload" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "sourceSummary" ALTER COLUMN "outputPayload" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "weeklyReportSource" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "weeklyReportSource" ALTER COLUMN "metadata" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "workspace" ALTER COLUMN "metadata" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaceCompetitor" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "workspaceCompetitor" ALTER COLUMN "metadata" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaceKeyword" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "workspaceKeyword" ALTER COLUMN "metadata" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaceSocialAccount" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "workspaceSocialAccount" ALTER COLUMN "metadata" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "feedbackEvent_reportId_idx" ON "feedbackEvent" USING btree ("reportId");--> statement-breakpoint
CREATE INDEX "feedbackEvent_sourceRecordId_idx" ON "feedbackEvent" USING btree ("sourceRecordId");--> statement-breakpoint
CREATE INDEX "searchResult_sourceRecordId_idx" ON "searchResult" USING btree ("sourceRecordId");--> statement-breakpoint
CREATE UNIQUE INDEX "weeklyReport_workspace_period_key" ON "weeklyReport" USING btree ("workspaceId","periodStart");
