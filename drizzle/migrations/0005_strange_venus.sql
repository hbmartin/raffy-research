CREATE TABLE "feedbackEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"reportId" text,
	"userId" text,
	"eventType" text NOT NULL,
	"targetType" text,
	"targetId" text,
	"sourceRecordId" text,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "ingestionRun" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text,
	"providerName" text NOT NULL,
	"runType" text NOT NULL,
	"status" text NOT NULL,
	"startedAt" timestamp (3) DEFAULT now() NOT NULL,
	"finishedAt" timestamp (3),
	"itemsIngested" integer DEFAULT 0 NOT NULL,
	"failureReason" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "internalNoteConfig" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"sourceSystem" text NOT NULL,
	"sourceRef" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "providerCallbackEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text,
	"providerName" text NOT NULL,
	"rawPayload" jsonb,
	"normalizationStatus" text DEFAULT 'pending' NOT NULL,
	"normalizationError" text,
	"sourceRecordId" text,
	"receivedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providerConfig" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"providerName" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"credentialsRef" text,
	"config" jsonb
);
--> statement-breakpoint
CREATE TABLE "searchResult" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"providerName" text NOT NULL,
	"query" text NOT NULL,
	"resultRank" integer,
	"title" text,
	"snippet" text,
	"url" text,
	"returnedAt" timestamp (3) DEFAULT now() NOT NULL,
	"sourceRecordId" text,
	"rawPayload" jsonb,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "sourceRecord" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"providerName" text NOT NULL,
	"providerSourceId" text,
	"sourceType" text NOT NULL,
	"sourceSubtype" text,
	"sourceName" text,
	"sourceUrl" text,
	"externalUrl" text,
	"title" text,
	"authorOrAccount" text,
	"domain" text,
	"publishedAt" timestamp (3),
	"capturedAt" timestamp (3) DEFAULT now() NOT NULL,
	"contentText" text,
	"diffAddedText" text,
	"diffRemovedText" text,
	"rawPayload" jsonb,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "sourceSummary" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"sourceRecordId" text NOT NULL,
	"summaryText" text,
	"evidenceCandidateText" text,
	"modelName" text,
	"modelProvider" text,
	"promptVersion" text,
	"inputMetadata" jsonb,
	"outputPayload" jsonb
);
--> statement-breakpoint
CREATE TABLE "weeklyReport" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"periodStart" timestamp (3) NOT NULL,
	"periodEnd" timestamp (3) NOT NULL,
	"timezone" text NOT NULL,
	"status" text NOT NULL,
	"generatedAt" timestamp (3),
	"publishedAt" timestamp (3),
	"title" text,
	"reportData" jsonb,
	"modelMetadata" jsonb,
	"failureReason" text
);
--> statement-breakpoint
CREATE TABLE "weeklyReportSource" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"reportId" text NOT NULL,
	"sourceRecordId" text NOT NULL,
	"relationType" text NOT NULL,
	"topicClusterId" text,
	"sectionKey" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"companyName" text NOT NULL,
	"companyDescription" text NOT NULL,
	"subcategory" text NOT NULL,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"website" text,
	"positioning" text,
	"icp" text,
	"marketAssumptions" text,
	"gtmFocus" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "workspaceCompetitor" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"state" text DEFAULT 'accepted' NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "workspaceKeyword" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"keywordString" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "workspaceSocialAccount" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"platform" text,
	"username" text,
	"profileUrl" text,
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "feedbackEvent" ADD CONSTRAINT "feedbackEvent_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedbackEvent" ADD CONSTRAINT "feedbackEvent_reportId_weeklyReport_id_fk" FOREIGN KEY ("reportId") REFERENCES "public"."weeklyReport"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedbackEvent" ADD CONSTRAINT "feedbackEvent_sourceRecordId_sourceRecord_id_fk" FOREIGN KEY ("sourceRecordId") REFERENCES "public"."sourceRecord"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestionRun" ADD CONSTRAINT "ingestionRun_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internalNoteConfig" ADD CONSTRAINT "internalNoteConfig_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providerCallbackEvent" ADD CONSTRAINT "providerCallbackEvent_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providerCallbackEvent" ADD CONSTRAINT "providerCallbackEvent_sourceRecordId_sourceRecord_id_fk" FOREIGN KEY ("sourceRecordId") REFERENCES "public"."sourceRecord"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providerConfig" ADD CONSTRAINT "providerConfig_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "searchResult" ADD CONSTRAINT "searchResult_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "searchResult" ADD CONSTRAINT "searchResult_sourceRecordId_sourceRecord_id_fk" FOREIGN KEY ("sourceRecordId") REFERENCES "public"."sourceRecord"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourceRecord" ADD CONSTRAINT "sourceRecord_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourceSummary" ADD CONSTRAINT "sourceSummary_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourceSummary" ADD CONSTRAINT "sourceSummary_sourceRecordId_sourceRecord_id_fk" FOREIGN KEY ("sourceRecordId") REFERENCES "public"."sourceRecord"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weeklyReport" ADD CONSTRAINT "weeklyReport_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weeklyReportSource" ADD CONSTRAINT "weeklyReportSource_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weeklyReportSource" ADD CONSTRAINT "weeklyReportSource_reportId_weeklyReport_id_fk" FOREIGN KEY ("reportId") REFERENCES "public"."weeklyReport"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weeklyReportSource" ADD CONSTRAINT "weeklyReportSource_sourceRecordId_sourceRecord_id_fk" FOREIGN KEY ("sourceRecordId") REFERENCES "public"."sourceRecord"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaceCompetitor" ADD CONSTRAINT "workspaceCompetitor_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaceKeyword" ADD CONSTRAINT "workspaceKeyword_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaceSocialAccount" ADD CONSTRAINT "workspaceSocialAccount_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedbackEvent_workspaceId_idx" ON "feedbackEvent" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "ingestionRun_workspaceId_idx" ON "ingestionRun" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "internalNoteConfig_workspaceId_idx" ON "internalNoteConfig" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "providerCallbackEvent_provider_idx" ON "providerCallbackEvent" USING btree ("providerName");--> statement-breakpoint
CREATE UNIQUE INDEX "providerConfig_workspace_provider_key" ON "providerConfig" USING btree ("workspaceId","providerName");--> statement-breakpoint
CREATE INDEX "searchResult_workspaceId_idx" ON "searchResult" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "sourceRecord_workspaceId_idx" ON "sourceRecord" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "sourceRecord_workspace_captured_idx" ON "sourceRecord" USING btree ("workspaceId","capturedAt");--> statement-breakpoint
CREATE INDEX "sourceSummary_sourceRecordId_idx" ON "sourceSummary" USING btree ("sourceRecordId");--> statement-breakpoint
CREATE INDEX "weeklyReport_workspaceId_idx" ON "weeklyReport" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "weeklyReport_workspace_period_idx" ON "weeklyReport" USING btree ("workspaceId","periodStart");--> statement-breakpoint
CREATE INDEX "weeklyReportSource_reportId_idx" ON "weeklyReportSource" USING btree ("reportId");--> statement-breakpoint
CREATE INDEX "weeklyReportSource_sourceRecordId_idx" ON "weeklyReportSource" USING btree ("sourceRecordId");--> statement-breakpoint
CREATE INDEX "workspaceCompetitor_workspaceId_idx" ON "workspaceCompetitor" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "workspaceKeyword_workspaceId_idx" ON "workspaceKeyword" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "workspaceSocialAccount_workspaceId_idx" ON "workspaceSocialAccount" USING btree ("workspaceId");