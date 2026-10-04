ALTER TABLE "sourceRecord" ADD COLUMN "equivalenceKey" text;--> statement-breakpoint
ALTER TABLE "newsletterJob" ADD COLUMN "budget" jsonb;--> statement-breakpoint
CREATE INDEX "sourceRecord_equivalence_base_idx" ON "sourceRecord" USING btree ("workspaceId","equivalenceKey");