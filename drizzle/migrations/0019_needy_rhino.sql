CREATE TABLE "machineCredential" (
	"id" text PRIMARY KEY NOT NULL,
	"secretHash" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"userId" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"pairingExpiresAt" timestamp (3) with time zone NOT NULL,
	"expiresAt" timestamp (3) with time zone NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "judgmentRecord" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"targetId" text NOT NULL,
	"kind" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agentOperation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"userId" text NOT NULL,
	"credentialId" text NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"input" jsonb NOT NULL,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stage" text DEFAULT 'queued' NOT NULL,
	"leaseToken" text,
	"leaseUntil" timestamp (3) with time zone,
	"cancelRequested" boolean DEFAULT false NOT NULL,
	"result" jsonb,
	"failure" text,
	"parentId" text,
	"externalJobId" text,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agentOperationEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"operationId" text NOT NULL,
	"data" jsonb NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agentOperationEvent" ADD CONSTRAINT "agentOperationEvent_operationId_agentOperation_id_fk" FOREIGN KEY ("operationId") REFERENCES "public"."agentOperation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "judgmentRecord_target_idx" ON "judgmentRecord" USING btree ("workspaceId","targetId","createdAt","id");--> statement-breakpoint
CREATE UNIQUE INDEX "agentOperation_idempotency_idx" ON "agentOperation" USING btree ("userId","workspaceId","key");--> statement-breakpoint
CREATE INDEX "agentOperation_queue_idx" ON "agentOperation" USING btree ("credentialId","status","createdAt");--> statement-breakpoint
CREATE INDEX "agentOperationEvent_page_idx" ON "agentOperationEvent" USING btree ("operationId","createdAt","id");