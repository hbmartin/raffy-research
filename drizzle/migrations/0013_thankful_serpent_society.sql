CREATE TABLE "newsletterJob" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"mode" text NOT NULL,
	"runtime" jsonb NOT NULL,
	"selectionId" text,
	"feedback" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stage" text DEFAULT 'queued' NOT NULL,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"leaseToken" text,
	"leaseUntil" timestamp (3),
	"failure" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletterWorkspace" (
	"workspaceId" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "newsletterJob" ADD CONSTRAINT "newsletterJob_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletterWorkspace" ADD CONSTRAINT "newsletterWorkspace_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "newsletterJob_key_idx" ON "newsletterJob" USING btree ("key");--> statement-breakpoint
CREATE INDEX "newsletterJob_claim_idx" ON "newsletterJob" USING btree ("mode","status","leaseUntil");