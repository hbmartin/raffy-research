CREATE TABLE "feedback_event" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"reportId" text,
	"userId" text,
	"eventType" text NOT NULL,
	"targetType" text NOT NULL,
	"targetId" text NOT NULL,
	"sourceRecordId" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_run" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text,
	"providerName" text,
	"runType" text NOT NULL,
	"status" text NOT NULL,
	"startedAt" timestamp (3) DEFAULT now() NOT NULL,
	"finishedAt" timestamp (3),
	"failureReason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "internal_note_config" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"sourceSystem" text NOT NULL,
	"sourceRef" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_callback_event" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text,
	"providerName" text NOT NULL,
	"status" text NOT NULL,
	"receivedAt" timestamp (3) DEFAULT now() NOT NULL,
	"normalizedAt" timestamp (3),
	"failureReason" text,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rawPayload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_config" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"providerName" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"credentialsRef" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_result" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"providerName" text NOT NULL,
	"query" text NOT NULL,
	"resultRank" integer,
	"title" text,
	"snippet" text,
	"url" text NOT NULL,
	"returnedAt" timestamp (3) DEFAULT now() NOT NULL,
	"sourceRecordId" text,
	"rawPayload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_record" (
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
	"rawPayload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_summary" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"sourceRecordId" text NOT NULL,
	"summaryText" text,
	"evidenceCandidateText" text,
	"modelName" text,
	"modelProvider" text,
	"promptVersion" text,
	"inputMetadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outputPayload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_report" (
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
	"reportData" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"modelMetadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failureReason" text
);
--> statement-breakpoint
CREATE TABLE "weekly_report_source" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"reportId" text NOT NULL,
	"sourceRecordId" text NOT NULL,
	"relationType" text NOT NULL,
	"topicClusterId" text,
	"sectionKey" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
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
	"companyWebsite" text,
	"currentPositioning" text,
	"knownIcp" text,
	"knownMarketAssumptions" text,
	"gtmFocusNotes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_competitor" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"state" text DEFAULT 'accepted' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_keyword" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"keywordString" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_social_account" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"platform" text,
	"username" text,
	"profileUrl" text,
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
DROP TABLE "author" CASCADE;--> statement-breakpoint
DROP TABLE "book" CASCADE;--> statement-breakpoint
DROP TABLE "publisher" CASCADE;--> statement-breakpoint
DROP TABLE "genre" CASCADE;--> statement-breakpoint
ALTER TABLE "feedback_event" ADD CONSTRAINT "feedback_event_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_event" ADD CONSTRAINT "feedback_event_reportId_weekly_report_id_fk" FOREIGN KEY ("reportId") REFERENCES "public"."weekly_report"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_event" ADD CONSTRAINT "feedback_event_sourceRecordId_source_record_id_fk" FOREIGN KEY ("sourceRecordId") REFERENCES "public"."source_record"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_run" ADD CONSTRAINT "ingestion_run_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_note_config" ADD CONSTRAINT "internal_note_config_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_callback_event" ADD CONSTRAINT "provider_callback_event_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_config" ADD CONSTRAINT "provider_config_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_result" ADD CONSTRAINT "search_result_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_result" ADD CONSTRAINT "search_result_sourceRecordId_source_record_id_fk" FOREIGN KEY ("sourceRecordId") REFERENCES "public"."source_record"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_summary" ADD CONSTRAINT "source_summary_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_summary" ADD CONSTRAINT "source_summary_sourceRecordId_source_record_id_fk" FOREIGN KEY ("sourceRecordId") REFERENCES "public"."source_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_report" ADD CONSTRAINT "weekly_report_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_report_source" ADD CONSTRAINT "weekly_report_source_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_report_source" ADD CONSTRAINT "weekly_report_source_reportId_weekly_report_id_fk" FOREIGN KEY ("reportId") REFERENCES "public"."weekly_report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_report_source" ADD CONSTRAINT "weekly_report_source_sourceRecordId_source_record_id_fk" FOREIGN KEY ("sourceRecordId") REFERENCES "public"."source_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_competitor" ADD CONSTRAINT "workspace_competitor_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_keyword" ADD CONSTRAINT "workspace_keyword_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_social_account" ADD CONSTRAINT "workspace_social_account_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_event_workspace_id_idx" ON "feedback_event" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "feedback_event_report_id_idx" ON "feedback_event" USING btree ("reportId");--> statement-breakpoint
CREATE INDEX "feedback_event_event_type_idx" ON "feedback_event" USING btree ("eventType");--> statement-breakpoint
CREATE INDEX "ingestion_run_workspace_id_idx" ON "ingestion_run" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "ingestion_run_status_idx" ON "ingestion_run" USING btree ("status");--> statement-breakpoint
CREATE INDEX "internal_note_config_workspace_id_idx" ON "internal_note_config" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "internal_note_config_source_system_idx" ON "internal_note_config" USING btree ("sourceSystem");--> statement-breakpoint
CREATE INDEX "provider_callback_event_workspace_id_idx" ON "provider_callback_event" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "provider_callback_event_provider_name_idx" ON "provider_callback_event" USING btree ("providerName");--> statement-breakpoint
CREATE INDEX "provider_callback_event_status_idx" ON "provider_callback_event" USING btree ("status");--> statement-breakpoint
CREATE INDEX "provider_config_workspace_id_idx" ON "provider_config" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "provider_config_provider_name_idx" ON "provider_config" USING btree ("providerName");--> statement-breakpoint
CREATE INDEX "search_result_workspace_id_idx" ON "search_result" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "search_result_returned_at_idx" ON "search_result" USING btree ("returnedAt");--> statement-breakpoint
CREATE INDEX "source_record_workspace_id_idx" ON "source_record" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "source_record_provider_name_idx" ON "source_record" USING btree ("providerName");--> statement-breakpoint
CREATE INDEX "source_record_captured_at_idx" ON "source_record" USING btree ("capturedAt");--> statement-breakpoint
CREATE INDEX "source_record_source_type_idx" ON "source_record" USING btree ("sourceType");--> statement-breakpoint
CREATE INDEX "source_summary_workspace_id_idx" ON "source_summary" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "source_summary_source_record_id_idx" ON "source_summary" USING btree ("sourceRecordId");--> statement-breakpoint
CREATE INDEX "weekly_report_workspace_id_idx" ON "weekly_report" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "weekly_report_status_idx" ON "weekly_report" USING btree ("status");--> statement-breakpoint
CREATE INDEX "weekly_report_period_idx" ON "weekly_report" USING btree ("periodStart","periodEnd");--> statement-breakpoint
CREATE INDEX "weekly_report_source_report_id_idx" ON "weekly_report_source" USING btree ("reportId");--> statement-breakpoint
CREATE INDEX "weekly_report_source_source_record_id_idx" ON "weekly_report_source" USING btree ("sourceRecordId");--> statement-breakpoint
CREATE INDEX "workspace_company_name_idx" ON "workspace" USING btree ("companyName");--> statement-breakpoint
CREATE INDEX "workspace_competitor_workspace_id_idx" ON "workspace_competitor" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "workspace_competitor_state_idx" ON "workspace_competitor" USING btree ("state");--> statement-breakpoint
CREATE INDEX "workspace_keyword_workspace_id_idx" ON "workspace_keyword" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "workspace_keyword_active_idx" ON "workspace_keyword" USING btree ("active");--> statement-breakpoint
CREATE INDEX "workspace_social_account_workspace_id_idx" ON "workspace_social_account" USING btree ("workspaceId");