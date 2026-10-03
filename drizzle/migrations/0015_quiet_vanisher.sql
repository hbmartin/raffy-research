CREATE TABLE "captureObservation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"providerName" text NOT NULL,
	"sourceRecordId" text NOT NULL,
	"kind" text NOT NULL,
	"runId" text,
	"callbackId" text,
	"jobId" text,
	"observationKey" text,
	"observedAt" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"rawPayload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "captureVersion" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"providerName" text NOT NULL,
	"versionKey" text NOT NULL,
	"sourceRecordId" text
);
--> statement-breakpoint
CREATE TABLE "evidenceEquivalenceDecision" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"reviewId" text NOT NULL,
	"actorId" text NOT NULL,
	"action" text NOT NULL,
	"decidedAt" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidenceEquivalenceReview" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"leftSourceId" text NOT NULL,
	"rightSourceId" text NOT NULL,
	"status" text DEFAULT 'suggested' NOT NULL,
	"actorId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"decidedAt" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "evidenceGroup" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"identity" text NOT NULL,
	"representativeId" text NOT NULL,
	"publicationDate" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidenceJudgment" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"sourceRecordId" text NOT NULL,
	"label" text,
	"judgedAt" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletterEvidence" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletterHistory" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"kind" text NOT NULL,
	"jobId" text NOT NULL,
	"reportId" text,
	"selectionId" text,
	"summary" text NOT NULL,
	"payload" jsonb NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "newsletterJob" ALTER COLUMN "leaseUntil" SET DATA TYPE timestamp (3) with time zone USING "leaseUntil" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "sourceRecord" ADD COLUMN "canonicalUrl" text;--> statement-breakpoint
ALTER TABLE "sourceRecord" ADD COLUMN "contentFingerprint" text;--> statement-breakpoint
ALTER TABLE "sourceRecord" ADD COLUMN "normalizedFingerprint" text;--> statement-breakpoint
ALTER TABLE "sourceRecord" ADD COLUMN "evidenceIdentity" text;--> statement-breakpoint
ALTER TABLE "newsletterJob" ADD COLUMN "targetReportId" text;--> statement-breakpoint
ALTER TABLE "newsletterJob" ADD COLUMN "parentAttemptId" text;--> statement-breakpoint
ALTER TABLE "newsletterJob" ADD COLUMN "initiatingActorId" text;--> statement-breakpoint
ALTER TABLE "newsletterJob" ADD COLUMN "localOperatorId" text;--> statement-breakpoint
ALTER TABLE "newsletterJob" ADD COLUMN "contextBudget" integer;--> statement-breakpoint
ALTER TABLE "captureObservation" ADD CONSTRAINT "captureObservation_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captureObservation" ADD CONSTRAINT "captureObservation_sourceRecordId_sourceRecord_id_fk" FOREIGN KEY ("sourceRecordId") REFERENCES "public"."sourceRecord"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captureVersion" ADD CONSTRAINT "captureVersion_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captureVersion" ADD CONSTRAINT "captureVersion_sourceRecordId_sourceRecord_id_fk" FOREIGN KEY ("sourceRecordId") REFERENCES "public"."sourceRecord"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidenceEquivalenceDecision" ADD CONSTRAINT "evidenceEquivalenceDecision_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidenceEquivalenceDecision" ADD CONSTRAINT "evidenceEquivalenceDecision_reviewId_evidenceEquivalenceReview_id_fk" FOREIGN KEY ("reviewId") REFERENCES "public"."evidenceEquivalenceReview"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidenceEquivalenceReview" ADD CONSTRAINT "evidenceEquivalenceReview_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidenceEquivalenceReview" ADD CONSTRAINT "evidenceEquivalenceReview_leftSourceId_sourceRecord_id_fk" FOREIGN KEY ("leftSourceId") REFERENCES "public"."sourceRecord"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidenceEquivalenceReview" ADD CONSTRAINT "evidenceEquivalenceReview_rightSourceId_sourceRecord_id_fk" FOREIGN KEY ("rightSourceId") REFERENCES "public"."sourceRecord"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidenceGroup" ADD CONSTRAINT "evidenceGroup_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidenceGroup" ADD CONSTRAINT "evidenceGroup_representativeId_sourceRecord_id_fk" FOREIGN KEY ("representativeId") REFERENCES "public"."sourceRecord"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidenceJudgment" ADD CONSTRAINT "evidenceJudgment_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidenceJudgment" ADD CONSTRAINT "evidenceJudgment_sourceRecordId_sourceRecord_id_fk" FOREIGN KEY ("sourceRecordId") REFERENCES "public"."sourceRecord"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletterEvidence" ADD CONSTRAINT "newsletterEvidence_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletterHistory" ADD CONSTRAINT "newsletterHistory_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "captureObservation_workspace_time_idx" ON "captureObservation" USING btree ("workspaceId","observedAt");--> statement-breakpoint
CREATE INDEX "captureObservation_job_idx" ON "captureObservation" USING btree ("workspaceId","jobId");--> statement-breakpoint
CREATE INDEX "captureObservation_source_idx" ON "captureObservation" USING btree ("sourceRecordId");--> statement-breakpoint
CREATE UNIQUE INDEX "captureObservation_key" ON "captureObservation" USING btree ("workspaceId","observationKey");--> statement-breakpoint
CREATE UNIQUE INDEX "captureVersion_identity_key" ON "captureVersion" USING btree ("workspaceId","providerName","versionKey");--> statement-breakpoint
CREATE INDEX "evidenceEquivalenceDecision_review_idx" ON "evidenceEquivalenceDecision" USING btree ("reviewId");--> statement-breakpoint
CREATE INDEX "evidenceEquivalenceReview_workspace_idx" ON "evidenceEquivalenceReview" USING btree ("workspaceId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "evidenceEquivalenceReview_pair_key" ON "evidenceEquivalenceReview" USING btree ("workspaceId","leftSourceId","rightSourceId");--> statement-breakpoint
CREATE UNIQUE INDEX "evidenceGroup_identity_key" ON "evidenceGroup" USING btree ("workspaceId","identity");--> statement-breakpoint
CREATE INDEX "evidenceJudgment_source_idx" ON "evidenceJudgment" USING btree ("sourceRecordId","judgedAt");--> statement-breakpoint
CREATE INDEX "newsletterEvidence_workspace_idx" ON "newsletterEvidence" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "newsletterHistory_page_idx" ON "newsletterHistory" USING btree ("workspaceId","createdAt","id");--> statement-breakpoint
CREATE INDEX "sourceRecord_equivalence_idx" ON "sourceRecord" USING btree ("workspaceId","evidenceIdentity");--> statement-breakpoint
CREATE INDEX "sourceRecord_normalized_idx" ON "sourceRecord" USING btree ("workspaceId","normalizedFingerprint");--> statement-breakpoint
CREATE INDEX "newsletterJob_publication_idx" ON "newsletterJob" USING btree ("workspaceId","targetReportId");--> statement-breakpoint
CREATE INDEX "newsletterJob_workspace_time_idx" ON "newsletterJob" USING btree ("workspaceId","createdAt");