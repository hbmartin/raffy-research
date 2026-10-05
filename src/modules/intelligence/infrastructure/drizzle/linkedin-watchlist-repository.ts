import { Result } from '@swan-io/boxed';
import { and, eq, sql } from 'drizzle-orm';

import type { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { JsonObject } from '@/modules/kernel/domain/json';
import type {
  Database,
  DbLike,
} from '@/modules/kernel/infrastructure/db/types';

import { mapIntelligenceDbError } from './map-db-error';
import {
  providerConfig,
  workspace,
  workspaceCompetitor,
  workspaceKeyword,
  workspaceSocialAccount,
} from './schema';
import type {
  LinkedinSnapshotOutcome,
  LinkedinWatchlistRepository,
  LinkedinWatchlistSnapshot,
  LinkedinWatchlistWriter,
} from '../../application/ports/linkedin-monitoring';
import { normalizeLinkedinUrl } from '../../domain/linkedin-monitoring';

async function readSnapshot(
  db: DbLike,
  workspaceId: string
): Promise<LinkedinSnapshotOutcome> {
  const [row] = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      companyName: workspace.companyName,
      companyDescription: workspace.companyDescription,
      subcategory: workspace.subcategory,
      icp: workspace.icp,
      gtmFocus: workspace.gtmFocus,
      positioning: workspace.positioning,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId));
  if (!row) return { type: 'workspace_not_found' };
  const keywords = await db
    .select({ value: workspaceKeyword.keywordString })
    .from(workspaceKeyword)
    .where(
      and(
        eq(workspaceKeyword.workspaceId, workspaceId),
        eq(workspaceKeyword.active, true)
      )
    );
  const competitors = await db
    .select({
      name: workspaceCompetitor.name,
      domain: workspaceCompetitor.domain,
      state: workspaceCompetitor.state,
    })
    .from(workspaceCompetitor)
    .where(eq(workspaceCompetitor.workspaceId, workspaceId));
  const accounts = await db
    .select({
      id: workspaceSocialAccount.id,
      platform: workspaceSocialAccount.platform,
      username: workspaceSocialAccount.username,
      profileUrl: workspaceSocialAccount.profileUrl,
      active: workspaceSocialAccount.active,
      metadata: workspaceSocialAccount.metadata,
    })
    .from(workspaceSocialAccount)
    .where(eq(workspaceSocialAccount.workspaceId, workspaceId));
  const [provider] = await db
    .select({
      id: providerConfig.id,
      enabled: providerConfig.enabled,
      credentialsRef: providerConfig.credentialsRef,
      config: providerConfig.config,
    })
    .from(providerConfig)
    .where(
      and(
        eq(providerConfig.workspaceId, workspaceId),
        eq(providerConfig.providerName, 'apify')
      )
    );
  return {
    type: 'watchlist_found',
    snapshot: {
      workspace: row,
      keywords: keywords.map((keyword) => keyword.value),
      competitors,
      accounts,
      ...(provider ? { provider } : {}),
    },
  };
}

function writerFor(
  db: DbLike,
  snapshot: LinkedinWatchlistSnapshot
): LinkedinWatchlistWriter {
  const workspaceId = snapshot.workspace.id;
  return {
    async selectProfiles(profiles, selectedAt) {
      try {
        for (const profile of profiles) {
          const existing = snapshot.accounts.find(
            (account) =>
              normalizeLinkedinUrl(account.profileUrl ?? '') === profile.url
          );
          const metadata = existing?.metadata ?? {};
          const history = Array.isArray(metadata.linkedinMonitoringSelections)
            ? metadata.linkedinMonitoringSelections
            : [];
          const provenance: JsonObject = {
            selectedAt,
            channel: 'codex-linkedin-monitoring',
            ...profile,
          };
          const values = {
            platform: 'linkedin',
            profileUrl: profile.url,
            active: true,
            metadata: {
              ...metadata,
              linkedinMonitoringSelections: [...history, provenance],
            },
          };
          if (existing) {
            await db
              .update(workspaceSocialAccount)
              .set({ ...values, updatedAt: new Date(selectedAt) })
              .where(
                and(
                  eq(workspaceSocialAccount.id, existing.id),
                  eq(workspaceSocialAccount.workspaceId, workspaceId)
                )
              );
          } else {
            await db.insert(workspaceSocialAccount).values({
              ...values,
              workspaceId,
              username: profile.url.split('/')[4],
            });
          }
        }
        return Result.Ok({ type: 'profiles_saved' } as const);
      } catch (error) {
        return Result.Error(
          mapIntelligenceDbError(error, 'LINKEDIN_PROFILES_SAVE_ERROR')
        );
      }
    },
    async saveProviderConfig(config) {
      try {
        const rows = await db
          .update(providerConfig)
          .set({ config, updatedAt: new Date() })
          .where(
            and(
              eq(providerConfig.workspaceId, workspaceId),
              eq(providerConfig.providerName, 'apify')
            )
          )
          .returning({ id: providerConfig.id });
        if (!rows.length)
          return Result.Error(
            mapIntelligenceDbError(null, 'LINKEDIN_PROVIDER_MISSING')
          );
        return Result.Ok({ type: 'config_saved' } as const);
      } catch (error) {
        return Result.Error(
          mapIntelligenceDbError(error, 'LINKEDIN_CONFIG_SAVE_ERROR')
        );
      }
    },
  };
}

export function createLinkedinWatchlistRepository(options: {
  db: Database;
}): LinkedinWatchlistRepository {
  const db = options.db;
  return {
    async read(workspaceId) {
      try {
        return Result.Ok(await readSnapshot(db, workspaceId));
      } catch (error) {
        return Result.Error(
          mapIntelligenceDbError(error, 'LINKEDIN_CONTEXT_READ_ERROR')
        );
      }
    },
    async withWorkspaceLock<T>(
      workspaceId: string,
      work: (
        snapshot: LinkedinWatchlistSnapshot,
        writer: LinkedinWatchlistWriter
      ) => Promise<Result<T, AppError>>
    ) {
      try {
        if (!db.$runInTransaction)
          return Result.Error(
            mapIntelligenceDbError(null, 'LINKEDIN_TRANSACTION_REQUIRED')
          );
        return await db.$runInTransaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
          await tx.execute(sql`SET LOCAL statement_timeout = '60s'`);
          await tx
            .select({ id: workspace.id })
            .from(workspace)
            .where(eq(workspace.id, workspaceId))
            .for('update');
          await tx
            .select({ id: providerConfig.id })
            .from(providerConfig)
            .where(
              and(
                eq(providerConfig.workspaceId, workspaceId),
                eq(providerConfig.providerName, 'apify')
              )
            )
            .for('update');
          const found = await readSnapshot(tx, workspaceId);
          if (found.type === 'workspace_not_found') return Result.Ok(found);
          const result = await work(
            found.snapshot,
            writerFor(tx, found.snapshot)
          );
          // The Drizzle contract requires rejection to roll back writes.
          if (result.isError()) throw result.getError();
          return result;
        });
      } catch (error) {
        return Result.Error(
          mapIntelligenceDbError(error, 'LINKEDIN_TRANSACTION_ERROR')
        );
      }
    },
  };
}
