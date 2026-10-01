CREATE TABLE "scheduledJobRun" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"startedAt" timestamp (3) NOT NULL,
	"finishedAt" timestamp (3),
	"total" integer DEFAULT 0 NOT NULL,
	"succeeded" integer DEFAULT 0 NOT NULL,
	"partial" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"items" integer DEFAULT 0 NOT NULL,
	"failureCode" text
);
--> statement-breakpoint
CREATE TABLE "scheduledJobWorkspaceRun" (
	"id" text PRIMARY KEY NOT NULL,
	"jobRunId" text NOT NULL,
	"workspaceId" text NOT NULL,
	"status" text NOT NULL,
	"startedAt" timestamp (3) NOT NULL,
	"finishedAt" timestamp (3) NOT NULL,
	"succeeded" integer DEFAULT 0 NOT NULL,
	"partial" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"items" integer DEFAULT 0 NOT NULL,
	"failureCode" text,
	"reportId" text
);
--> statement-breakpoint
ALTER TABLE "ingestionRun" ADD COLUMN "scheduledJobRunId" text;--> statement-breakpoint
ALTER TABLE "scheduledJobWorkspaceRun" ADD CONSTRAINT "scheduledJobWorkspaceRun_jobRunId_scheduledJobRun_id_fk" FOREIGN KEY ("jobRunId") REFERENCES "public"."scheduledJobRun"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduledJobWorkspaceRun" ADD CONSTRAINT "scheduledJobWorkspaceRun_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduledJobWorkspaceRun" ADD CONSTRAINT "scheduledJobWorkspaceRun_reportId_weeklyReport_id_fk" FOREIGN KEY ("reportId") REFERENCES "public"."weeklyReport"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduledJobRun_startedAt_idx" ON "scheduledJobRun" USING btree ("startedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduledJobWorkspaceRun_job_workspace_idx" ON "scheduledJobWorkspaceRun" USING btree ("jobRunId","workspaceId");--> statement-breakpoint
CREATE INDEX "scheduledJobWorkspaceRun_workspace_idx" ON "scheduledJobWorkspaceRun" USING btree ("workspaceId");--> statement-breakpoint
ALTER TABLE "ingestionRun" ADD CONSTRAINT "ingestionRun_scheduledJobRunId_scheduledJobRun_id_fk" FOREIGN KEY ("scheduledJobRunId") REFERENCES "public"."scheduledJobRun"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingestionRun_scheduledJobRunId_idx" ON "ingestionRun" USING btree ("scheduledJobRunId");