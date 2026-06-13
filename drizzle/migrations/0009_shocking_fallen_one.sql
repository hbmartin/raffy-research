CREATE TABLE "reportRubricScore" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"workspaceId" text NOT NULL,
	"reportId" text NOT NULL,
	"userId" text NOT NULL,
	"relevance" integer NOT NULL,
	"accuracy" integer NOT NULL,
	"novelty" integer NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "sourceRecord" ADD COLUMN "relevanceLabel" text;--> statement-breakpoint
ALTER TABLE "sourceRecord" ADD COLUMN "labeledAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "reportRubricScore" ADD CONSTRAINT "reportRubricScore_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reportRubricScore" ADD CONSTRAINT "reportRubricScore_reportId_weeklyReport_id_fk" FOREIGN KEY ("reportId") REFERENCES "public"."weeklyReport"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reportRubricScore_workspaceId_idx" ON "reportRubricScore" USING btree ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "reportRubricScore_report_user_idx" ON "reportRubricScore" USING btree ("reportId","userId");