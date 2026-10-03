ALTER TABLE "sourceRecord" ADD COLUMN "similarityBucket" text;--> statement-breakpoint
CREATE INDEX "sourceRecord_similarity_idx" ON "sourceRecord" USING btree ("workspaceId","similarityBucket");