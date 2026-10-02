import type {
  IngestionRunId,
  ProviderCallbackEventId,
  SourceRecordId,
  WorkspaceId,
} from '@/modules/kernel/domain/ids';
import type { JsonObject, JsonValue } from '@/modules/kernel/domain/json';

import type { ProviderName } from './provider';

export type IngestionRunType = 'daily' | 'callback' | 'manual' | 'weekly';
export type IngestionRunStatus =
  | 'started'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'skipped';

export type IngestionRun = {
  id: IngestionRunId;
  workspaceId: WorkspaceId | null;
  scheduledJobRunId?: string | null;
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
  scheduledJobRunId?: string | null;
  providerName: ProviderName | string;
  runType: IngestionRunType;
  status: IngestionRunStatus;
  startedAt?: Date;
  finishedAt?: Date | null;
  itemsIngested?: number;
  failureReason?: string | null;
  metadata?: JsonObject | null;
};

export type LastSuccessfulRunOutcome =
  | { type: 'last_run_found'; startedAt: Date }
  | { type: 'no_previous_run' };

/** How far back a provider's first-ever pull reaches. */
export const DEFAULT_INGEST_WINDOW_MS = 24 * 60 * 60 * 1000;
/** The furthest back any pull reaches, however long a provider sat idle. */
export const MAX_INGEST_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Where a provider's daily pull starts: the moment its last successful pull
 * started, so consecutive runs cover adjoining windows and a second run on the
 * same day does not re-capture what the first one stored.
 *
 * With no successful run yet, the window is the last 24 hours. A watermark
 * older than the lookback cap is pulled forward, so re-enabling a provider
 * after weeks does not backfill weeks; one in the future (clock skew, bad
 * data) is pulled back to `now`.
 */
export function resolveIngestWindowStart(input: {
  now: Date;
  lastSuccessfulRun: LastSuccessfulRunOutcome;
}): Date {
  const nowMs = input.now.getTime();
  const startMs =
    input.lastSuccessfulRun.type === 'last_run_found'
      ? input.lastSuccessfulRun.startedAt.getTime()
      : nowMs - DEFAULT_INGEST_WINDOW_MS;
  return new Date(
    Math.min(nowMs, Math.max(nowMs - MAX_INGEST_LOOKBACK_MS, startMs))
  );
}
