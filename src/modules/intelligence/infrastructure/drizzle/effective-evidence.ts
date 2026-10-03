import { sql } from 'drizzle-orm';

/** Clearing a judgment is an explicit event, so a latest null must survive. */
export const effectiveEvidenceLabel = sql<'keep' | 'junk' | null>`(
  select judgment."relevanceLabel" from "sourceRecord" judgment
  where judgment."workspaceId" = "sourceRecord"."workspaceId"
    and (judgment."evidenceIdentity" = "sourceRecord"."evidenceIdentity"
      or judgment."id" = "sourceRecord"."id")
    and (judgment."labeledAt" is not null or judgment."relevanceLabel" is not null)
  order by coalesce(judgment."labeledAt", judgment."updatedAt") desc, judgment."id" desc limit 1
)`;
