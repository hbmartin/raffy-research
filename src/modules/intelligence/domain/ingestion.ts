import type {
  IngestionRunId,
  ProviderCallbackEventId,
  SourceRecordId,
  WorkspaceId,
} from '@/modules/kernel/domain/ids';
import type { JsonObject, JsonValue } from '@/modules/kernel/domain/json';

import type { ProviderName } from './provider';

export type IngestionRunType = 'daily' | 'callback' | 'manual' | 'weekly';
export type IngestionRunStatus = 'started' | 'succeeded' | 'failed' | 'skipped';

export type IngestionRun = {
  id: IngestionRunId;
  workspaceId: WorkspaceId | null;
  providerName: string;
  runType: IngestionRunType;
  status: IngestionRunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  itemsIngested: number;
  failureReason: string | null;
  metadata: JsonObject | null;
  createdAt: Date;
};

export type CallbackNormalizationStatus =
  | 'pending'
  | 'normalized'
  | 'failed'
  | 'skipped';

export type ProviderCallbackEvent = {
  id: ProviderCallbackEventId;
  workspaceId: WorkspaceId | null;
  providerName: string;
  rawPayload: JsonValue | null;
  normalizationStatus: CallbackNormalizationStatus;
  normalizationError: string | null;
  sourceRecordId: SourceRecordId | null;
  receivedAt: Date;
  createdAt: Date;
};

export type ProviderCallbackEventWriteInput = {
  workspaceId?: WorkspaceId | null;
  providerName: string;
  rawPayload: JsonValue | null;
};

export type IngestionRunWriteInput = {
  workspaceId?: WorkspaceId | null;
  providerName: ProviderName | string;
  runType: IngestionRunType;
  status: IngestionRunStatus;
  startedAt?: Date;
  finishedAt?: Date | null;
  itemsIngested?: number;
  failureReason?: string | null;
  metadata?: JsonObject | null;
};
