import { Result } from '@swan-io/boxed';
import { and, asc, eq, inArray } from 'drizzle-orm';

import type {
  CompetitorId,
  InternalNoteConfigId,
  KeywordId,
  ProviderConfigId,
  WorkspaceId,
} from '@/modules/kernel/domain/ids';
import {
  toCompetitorId,
  toInternalNoteConfigId,
  toKeywordId,
  toProviderConfigId,
  toSocialAccountId,
  toWorkspaceId,
} from '@/modules/kernel/domain/ids';
import { observeRepository } from '@/modules/kernel/infrastructure/db/observability';
import type { DbLike } from '@/modules/kernel/infrastructure/db/types';

import {
  intelligenceInvariantError,
  mapIntelligenceDbError,
} from './map-db-error';
import {
  internalNoteConfig as internalNoteConfigTable,
  providerConfig as providerConfigTable,
  workspace as workspaceTable,
  workspaceCompetitor as competitorTable,
  workspaceKeyword as keywordTable,
  workspaceSocialAccount as socialAccountTable,
} from './schema';
import type { WorkspaceRepository } from '../../application/ports/workspace-repository';
import type {
  InternalNoteConfig,
  InternalNoteSystem,
  ProviderConfig,
  ProviderConfigWriteInput,
  ProviderName,
} from '../../domain/provider';
import type {
  Competitor,
  CompetitorState,
  Keyword,
  SocialAccount,
  Workspace,
  WorkspaceWriteInput,
} from '../../domain/workspace';
import { normalizeWorkspaceWriteInput } from '../../domain/workspace';

type WorkspaceRow = typeof workspaceTable.$inferSelect;
type KeywordRow = typeof keywordTable.$inferSelect;
type SocialRow = typeof socialAccountTable.$inferSelect;
type CompetitorRow = typeof competitorTable.$inferSelect;
type ProviderConfigRow = typeof providerConfigTable.$inferSelect;
type InternalNoteRow = typeof internalNoteConfigTable.$inferSelect;

const toWorkspace = (row: WorkspaceRow): Workspace => ({
  id: toWorkspaceId(row.id),
  name: row.name,
  companyName: row.companyName,
  companyDescription: row.companyDescription,
  subcategory: row.subcategory,
  timezone: row.timezone,
  website: row.website,
  positioning: row.positioning,
  icp: row.icp,
  marketAssumptions: row.marketAssumptions,
  gtmFocus: row.gtmFocus,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toKeyword = (row: KeywordRow): Keyword => ({
  id: toKeywordId(row.id),
  workspaceId: toWorkspaceId(row.workspaceId),
  keywordString: row.keywordString,
  active: row.active,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toSocialAccount = (row: SocialRow): SocialAccount => ({
  id: toSocialAccountId(row.id),
  workspaceId: toWorkspaceId(row.workspaceId),
  platform: row.platform,
  username: row.username,
  profileUrl: row.profileUrl,
  active: row.active,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toCompetitor = (row: CompetitorRow): Competitor => ({
  id: toCompetitorId(row.id),
  workspaceId: toWorkspaceId(row.workspaceId),
  name: row.name,
  domain: row.domain,
  state: row.state,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toProviderConfig = (row: ProviderConfigRow): ProviderConfig => ({
  id: toProviderConfigId(row.id),
  workspaceId: toWorkspaceId(row.workspaceId),
  providerName: row.providerName as ProviderName,
  enabled: row.enabled,
  credentialsRef: row.credentialsRef,
  config: row.config ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toInternalNoteConfig = (row: InternalNoteRow): InternalNoteConfig => ({
  id: toInternalNoteConfigId(row.id),
  workspaceId: toWorkspaceId(row.workspaceId),
  sourceSystem: row.sourceSystem,
  sourceRef: row.sourceRef,
  enabled: row.enabled,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class WorkspaceRepositoryDrizzle implements WorkspaceRepository {
  constructor(private readonly db: DbLike) {}

  async list() {
    try {
      const rows = await this.db
        .select()
        .from(workspaceTable)
        .orderBy(asc(workspaceTable.name));
      return Result.Ok(rows.map(toWorkspace));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'WORKSPACE_LIST_ERROR')
      );
    }
  }

  async getById(id: WorkspaceId) {
    try {
      const [row] = await this.db
        .select()
        .from(workspaceTable)
        .where(eq(workspaceTable.id, id))
        .limit(1);
      return Result.Ok(
        row
          ? ({ type: 'workspace_found', workspace: toWorkspace(row) } as const)
          : ({ type: 'workspace_not_found' } as const)
      );
    } catch (error) {
      return Result.Error(mapIntelligenceDbError(error, 'WORKSPACE_GET_ERROR'));
    }
  }

  async create(input: WorkspaceWriteInput) {
    try {
      const values = normalizeWorkspaceWriteInput(input);
      const [created] = await this.db
        .insert(workspaceTable)
        .values(values)
        .returning();
      if (!created) {
        return Result.Error(
          intelligenceInvariantError(
            'WORKSPACE_CREATE_EMPTY',
            'workspace insert returned no row'
          )
        );
      }
      return Result.Ok(toWorkspace(created));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'WORKSPACE_CREATE_ERROR')
      );
    }
  }

  async update(id: WorkspaceId, input: WorkspaceWriteInput) {
    try {
      const values = normalizeWorkspaceWriteInput(input);
      const [updated] = await this.db
        .update(workspaceTable)
        .set(values)
        .where(eq(workspaceTable.id, id))
        .returning();
      return Result.Ok(
        updated
          ? ({
              type: 'workspace_updated',
              workspace: toWorkspace(updated),
            } as const)
          : ({ type: 'workspace_not_found' } as const)
      );
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'WORKSPACE_UPDATE_ERROR')
      );
    }
  }

  async listKeywords(
    workspaceId: WorkspaceId,
    options?: { activeOnly?: boolean }
  ) {
    try {
      const where = options?.activeOnly
        ? and(
            eq(keywordTable.workspaceId, workspaceId),
            eq(keywordTable.active, true)
          )
        : eq(keywordTable.workspaceId, workspaceId);
      const rows = await this.db
        .select()
        .from(keywordTable)
        .where(where)
        .orderBy(asc(keywordTable.keywordString));
      return Result.Ok(rows.map(toKeyword));
    } catch (error) {
      return Result.Error(mapIntelligenceDbError(error, 'KEYWORD_LIST_ERROR'));
    }
  }

  async createKeyword(input: {
    workspaceId: WorkspaceId;
    keywordString: string;
    active?: boolean;
  }) {
    try {
      const [created] = await this.db
        .insert(keywordTable)
        .values({
          workspaceId: input.workspaceId,
          keywordString: input.keywordString.trim(),
          active: input.active ?? true,
        })
        .returning();
      if (!created) {
        return Result.Error(
          intelligenceInvariantError(
            'KEYWORD_CREATE_EMPTY',
            'keyword insert returned no row'
          )
        );
      }
      return Result.Ok(toKeyword(created));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'KEYWORD_CREATE_ERROR')
      );
    }
  }

  async setKeywordActive(
    workspaceId: WorkspaceId,
    keywordId: KeywordId,
    active: boolean
  ) {
    try {
      const [updated] = await this.db
        .update(keywordTable)
        .set({ active })
        .where(
          and(
            eq(keywordTable.id, keywordId),
            eq(keywordTable.workspaceId, workspaceId)
          )
        )
        .returning({ id: keywordTable.id });
      return Result.Ok(
        updated
          ? ({ type: 'keyword_updated' } as const)
          : ({ type: 'keyword_not_found' } as const)
      );
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'KEYWORD_UPDATE_ERROR')
      );
    }
  }

  async listSocialAccounts(workspaceId: WorkspaceId) {
    try {
      const rows = await this.db
        .select()
        .from(socialAccountTable)
        .where(eq(socialAccountTable.workspaceId, workspaceId))
        .orderBy(asc(socialAccountTable.createdAt));
      return Result.Ok(rows.map(toSocialAccount));
    } catch (error) {
      return Result.Error(mapIntelligenceDbError(error, 'SOCIAL_LIST_ERROR'));
    }
  }

  async createSocialAccount(input: {
    workspaceId: WorkspaceId;
    platform?: string | null;
    username?: string | null;
    profileUrl?: string | null;
  }) {
    try {
      const [created] = await this.db
        .insert(socialAccountTable)
        .values({
          workspaceId: input.workspaceId,
          platform: input.platform ?? null,
          username: input.username ?? null,
          profileUrl: input.profileUrl ?? null,
        })
        .returning();
      if (!created) {
        return Result.Error(
          intelligenceInvariantError(
            'SOCIAL_CREATE_EMPTY',
            'social account insert returned no row'
          )
        );
      }
      return Result.Ok(toSocialAccount(created));
    } catch (error) {
      return Result.Error(mapIntelligenceDbError(error, 'SOCIAL_CREATE_ERROR'));
    }
  }

  async listCompetitors(
    workspaceId: WorkspaceId,
    options?: { states?: CompetitorState[] }
  ) {
    try {
      const where =
        options?.states && options.states.length > 0
          ? and(
              eq(competitorTable.workspaceId, workspaceId),
              inArray(competitorTable.state, options.states)
            )
          : eq(competitorTable.workspaceId, workspaceId);
      const rows = await this.db
        .select()
        .from(competitorTable)
        .where(where)
        .orderBy(asc(competitorTable.name));
      return Result.Ok(rows.map(toCompetitor));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'COMPETITOR_LIST_ERROR')
      );
    }
  }

  async createCompetitor(input: {
    workspaceId: WorkspaceId;
    name: string;
    domain?: string | null;
    state?: CompetitorState;
  }) {
    try {
      const [created] = await this.db
        .insert(competitorTable)
        .values({
          workspaceId: input.workspaceId,
          name: input.name.trim(),
          domain: input.domain ?? null,
          state: input.state ?? 'accepted',
        })
        .returning();
      if (!created) {
        return Result.Error(
          intelligenceInvariantError(
            'COMPETITOR_CREATE_EMPTY',
            'competitor insert returned no row'
          )
        );
      }
      return Result.Ok(toCompetitor(created));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'COMPETITOR_CREATE_ERROR')
      );
    }
  }

  async setCompetitorState(
    workspaceId: WorkspaceId,
    competitorId: CompetitorId,
    state: CompetitorState
  ) {
    try {
      const [updated] = await this.db
        .update(competitorTable)
        .set({ state })
        .where(
          and(
            eq(competitorTable.id, competitorId),
            eq(competitorTable.workspaceId, workspaceId)
          )
        )
        .returning();
      return Result.Ok(
        updated
          ? ({
              type: 'competitor_updated',
              competitor: toCompetitor(updated),
            } as const)
          : ({ type: 'competitor_not_found' } as const)
      );
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'COMPETITOR_UPDATE_ERROR')
      );
    }
  }

  async listProviderConfigs(workspaceId: WorkspaceId) {
    try {
      const rows = await this.db
        .select()
        .from(providerConfigTable)
        .where(eq(providerConfigTable.workspaceId, workspaceId))
        .orderBy(asc(providerConfigTable.providerName));
      return Result.Ok(rows.map(toProviderConfig));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'PROVIDER_CONFIG_LIST_ERROR')
      );
    }
  }

  async getProviderConfig(
    workspaceId: WorkspaceId,
    providerName: ProviderName
  ) {
    try {
      const [row] = await this.db
        .select()
        .from(providerConfigTable)
        .where(
          and(
            eq(providerConfigTable.workspaceId, workspaceId),
            eq(providerConfigTable.providerName, providerName)
          )
        )
        .limit(1);
      return Result.Ok(row ? toProviderConfig(row) : null);
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'PROVIDER_CONFIG_GET_ERROR')
      );
    }
  }

  async upsertProviderConfig(input: ProviderConfigWriteInput) {
    try {
      const [row] = await this.db
        .insert(providerConfigTable)
        .values({
          workspaceId: input.workspaceId,
          providerName: input.providerName,
          enabled: input.enabled,
          credentialsRef: input.credentialsRef ?? null,
          config: input.config ?? null,
        })
        .onConflictDoUpdate({
          target: [
            providerConfigTable.workspaceId,
            providerConfigTable.providerName,
          ],
          set: {
            enabled: input.enabled,
            credentialsRef: input.credentialsRef ?? null,
            config: input.config ?? null,
          },
        })
        .returning();
      if (!row) {
        return Result.Error(
          intelligenceInvariantError(
            'PROVIDER_CONFIG_UPSERT_EMPTY',
            'provider config upsert returned no row'
          )
        );
      }
      return Result.Ok(toProviderConfig(row));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'PROVIDER_CONFIG_UPSERT_ERROR')
      );
    }
  }

  async deleteProviderConfig(workspaceId: WorkspaceId, id: ProviderConfigId) {
    try {
      const [deleted] = await this.db
        .delete(providerConfigTable)
        .where(
          and(
            eq(providerConfigTable.id, id),
            eq(providerConfigTable.workspaceId, workspaceId)
          )
        )
        .returning({ id: providerConfigTable.id });
      return Result.Ok(
        deleted
          ? ({ type: 'provider_config_deleted' } as const)
          : ({ type: 'provider_config_not_found' } as const)
      );
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'PROVIDER_CONFIG_DELETE_ERROR')
      );
    }
  }

  async listInternalNoteConfigs(
    workspaceId: WorkspaceId,
    options?: { enabledOnly?: boolean }
  ) {
    try {
      const where = options?.enabledOnly
        ? and(
            eq(internalNoteConfigTable.workspaceId, workspaceId),
            eq(internalNoteConfigTable.enabled, true)
          )
        : eq(internalNoteConfigTable.workspaceId, workspaceId);
      const rows = await this.db
        .select()
        .from(internalNoteConfigTable)
        .where(where)
        .orderBy(asc(internalNoteConfigTable.createdAt));
      return Result.Ok(rows.map(toInternalNoteConfig));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'INTERNAL_NOTE_LIST_ERROR')
      );
    }
  }

  async createInternalNoteConfig(input: {
    workspaceId: WorkspaceId;
    sourceSystem: InternalNoteSystem;
    sourceRef: string;
    enabled?: boolean;
  }) {
    try {
      const [created] = await this.db
        .insert(internalNoteConfigTable)
        .values({
          workspaceId: input.workspaceId,
          sourceSystem: input.sourceSystem,
          sourceRef: input.sourceRef.trim(),
          enabled: input.enabled ?? true,
        })
        .returning();
      if (!created) {
        return Result.Error(
          intelligenceInvariantError(
            'INTERNAL_NOTE_CREATE_EMPTY',
            'internal note insert returned no row'
          )
        );
      }
      return Result.Ok(toInternalNoteConfig(created));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'INTERNAL_NOTE_CREATE_ERROR')
      );
    }
  }

  async deleteInternalNoteConfig(
    workspaceId: WorkspaceId,
    id: InternalNoteConfigId
  ) {
    try {
      const [deleted] = await this.db
        .delete(internalNoteConfigTable)
        .where(
          and(
            eq(internalNoteConfigTable.id, id),
            eq(internalNoteConfigTable.workspaceId, workspaceId)
          )
        )
        .returning({ id: internalNoteConfigTable.id });
      return Result.Ok(
        deleted
          ? ({ type: 'internal_note_deleted' } as const)
          : ({ type: 'internal_note_not_found' } as const)
      );
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'INTERNAL_NOTE_DELETE_ERROR')
      );
    }
  }
}

export function createWorkspaceRepository(dependencies: {
  db: DbLike;
}): WorkspaceRepository {
  return observeRepository(
    new WorkspaceRepositoryDrizzle(dependencies.db),
    'intelligence.workspace'
  );
}
