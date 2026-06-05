import { Result } from '@swan-io/boxed';
import { desc, eq } from 'drizzle-orm';

import type {
  IngestionRunId,
  ProviderCallbackEventId,
  SourceRecordId,
} from '@/modules/kernel/domain/ids';
import {
  toIngestionRunId,
  toProviderCallbackEventId,
  toSourceRecordId,
  toWorkspaceId,
} from '@/modules/kernel/domain/ids';
import type { JsonObject } from '@/modules/kernel/domain/json';
import { observeRepository } from '@/modules/kernel/infrastructure/db/observability';
import type { DbLike } from '@/modules/kernel/infrastructure/db/types';

import {
  intelligenceInvariantError,
  mapIntelligenceDbError,
} from './map-db-error';
import {
  ingestionRun as ingestionRunTable,
  providerCallbackEvent as providerCallbackEventTable,
} from './schema';
import type { IngestionRepository } from '../../application/ports/ingestion-repository';
import type {
  CallbackNormalizationStatus,
  IngestionRun,
  IngestionRunStatus,
  IngestionRunWriteInput,
  ProviderCallbackEvent,
  ProviderCallbackEventWriteInput,
} from '../../domain/ingestion';

type RunRow = typeof ingestionRunTable.$inferSelect;
type CallbackRow = typeof providerCallbackEventTable.$inferSelect;

const toIngestionRun = (row: RunRow): IngestionRun => ({
  id: toIngestionRunId(row.id),
  workspaceId: row.workspaceId ? toWorkspaceId(row.workspaceId) : null,
  providerName: row.providerName,
  runType: row.runType,
  status: row.status,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
  itemsIngested: row.itemsIngested,
  failureReason: row.failureReason,
  metadata: row.metadata ?? null,
  createdAt: row.createdAt,
});

const toCallbackEvent = (row: CallbackRow): ProviderCallbackEvent => ({
  id: toProviderCallbackEventId(row.id),
  workspaceId: row.workspaceId ? toWorkspaceId(row.workspaceId) : null,
  providerName: row.providerName,
  rawPayload: row.rawPayload,
  normalizationStatus: row.normalizationStatus,
  normalizationError: row.normalizationError,
  sourceRecordId: row.sourceRecordId
    ? toSourceRecordId(row.sourceRecordId)
    : null,
  receivedAt: row.receivedAt,
  createdAt: row.createdAt,
});

export class IngestionRepositoryDrizzle implements IngestionRepository {
  constructor(private readonly db: DbLike) {}

  async startRun(input: IngestionRunWriteInput) {
    try {
      const [created] = await this.db
        .insert(ingestionRunTable)
        .values({
          workspaceId: input.workspaceId ?? null,
          providerName: input.providerName,
          runType: input.runType,
          status: input.status,
          startedAt: input.startedAt ?? undefined,
          finishedAt: input.finishedAt ?? null,
          itemsIngested: input.itemsIngested ?? 0,
          failureReason: input.failureReason ?? null,
          metadata: input.metadata ?? {},
        })
        .returning();
      if (!created) {
        return Result.Error(
          intelligenceInvariantError(
            'INGESTION_RUN_CREATE_EMPTY',
            'ingestion run insert returned no row'
          )
        );
      }
      return Result.Ok(toIngestionRun(created));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'INGESTION_RUN_CREATE_ERROR')
      );
    }
  }

  async finishRun(
    id: IngestionRunId,
    input: {
      status: IngestionRunStatus;
      itemsIngested?: number;
      failureReason?: string | null;
      finishedAt?: Date;
      metadata?: JsonObject | null;
    }
  ) {
    try {
      const [updated] = await this.db
        .update(ingestionRunTable)
        .set({
          status: input.status,
          itemsIngested: input.itemsIngested,
          failureReason: input.failureReason ?? null,
          finishedAt: input.finishedAt ?? new Date(),
          metadata: input.metadata ?? {},
        })
        .where(eq(ingestionRunTable.id, id))
        .returning({ id: ingestionRunTable.id });
      return Result.Ok(
        updated
          ? ({ type: 'run_updated' } as const)
          : ({ type: 'run_not_found' } as const)
      );
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'INGESTION_RUN_UPDATE_ERROR')
      );
    }
  }

  async recordCallbackEvent(input: ProviderCallbackEventWriteInput) {
    try {
      const [created] = await this.db
        .insert(providerCallbackEventTable)
        .values({
          workspaceId: input.workspaceId ?? null,
          providerName: input.providerName,
          rawPayload: input.rawPayload ?? {},
          normalizationStatus: 'pending',
        })
        .returning();
      if (!created) {
        return Result.Error(
          intelligenceInvariantError(
            'CALLBACK_CREATE_EMPTY',
            'callback event insert returned no row'
          )
        );
      }
      return Result.Ok(toCallbackEvent(created));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'CALLBACK_CREATE_ERROR')
      );
    }
  }

  async updateCallbackNormalization(
    id: ProviderCallbackEventId,
    input: {
      normalizationStatus: CallbackNormalizationStatus;
      normalizationError?: string | null;
      sourceRecordId?: SourceRecordId | null;
    }
  ) {
    try {
      const [updated] = await this.db
        .update(providerCallbackEventTable)
        .set({
          normalizationStatus: input.normalizationStatus,
          normalizationError: input.normalizationError ?? null,
          sourceRecordId: input.sourceRecordId ?? null,
        })
        .where(eq(providerCallbackEventTable.id, id))
        .returning({ id: providerCallbackEventTable.id });
      return Result.Ok(
        updated
          ? ({ type: 'callback_updated' } as const)
          : ({ type: 'callback_not_found' } as const)
      );
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'CALLBACK_UPDATE_ERROR')
      );
    }
  }

  async listCallbackEvents(input: { workspaceId: string; limit?: number }) {
    try {
      const rows = await this.db
        .select()
        .from(providerCallbackEventTable)
        .where(eq(providerCallbackEventTable.workspaceId, input.workspaceId))
        .orderBy(desc(providerCallbackEventTable.receivedAt))
        .limit(input.limit ?? 50);
      return Result.Ok(rows.map(toCallbackEvent));
    } catch (error) {
      return Result.Error(mapIntelligenceDbError(error, 'CALLBACK_LIST_ERROR'));
    }
  }
}

export function createIngestionRepository(dependencies: {
  db: DbLike;
}): IngestionRepository {
  return observeRepository(
    new IngestionRepositoryDrizzle(dependencies.db),
    'intelligence.ingestion'
  );
}
