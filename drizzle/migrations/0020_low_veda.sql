ALTER TABLE "evidenceJudgment" ADD COLUMN "provenance" jsonb DEFAULT '{"origin":"unknown"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sourceRecord" ADD COLUMN "labelProvenance" jsonb;
--> statement-breakpoint
INSERT INTO "judgmentRecord" ("id", "workspaceId", "targetId", "kind", "provenance", "payload", "createdAt")
SELECT 'legacy-rubric:' || "id", "workspaceId", "reportId", 'rubric', jsonb_build_object('origin', 'human', 'channel', 'legacy', 'actorId', "userId"), jsonb_build_object('relevance', "relevance", 'accuracy', "accuracy", 'novelty', "novelty", 'note', "note"), "updatedAt"
FROM "reportRubricScore" ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
UPDATE "sourceRecord" SET "labelProvenance" = '{"origin":"unknown"}'::jsonb WHERE "labeledAt" IS NOT NULL OR "relevanceLabel" IS NOT NULL;
