import type { ApplicationResult } from '@/modules/kernel/application/result';
import type {
  IngestionRunId,
  ProviderCallbackEventId,
  SourceRecordId,
} from '@/modules/kernel/domain/ids';
import type { JsonObject } from '@/modules/kernel/domain/json';

import type {
  CallbackNormalizationStatus,
  IngestionRun,
  IngestionRunStatus,
  IngestionRunWriteInput,
  ProviderCallbackEvent,
  ProviderCallbackEventWriteInput,
} from '../../domain/ingestion';

export interface IngestionRepository {
  startRun(
    input: IngestionRunWriteInput
  ): Promise<ApplicationResult<IngestionRun>>;
  finishRun(
    id: IngestionRunId,
    input: {
      status: IngestionRunStatus;
      itemsIngested?: number;
      failureReason?: string | null;
      finishedAt?: Date;
      metadata?: JsonObject | null;
    }
  ): Promise<ApplicationResult<{ type: 'run_updated' | 'run_not_found' }>>;

  recordCallbackEvent(
    input: ProviderCallbackEventWriteInput
  ): Promise<ApplicationResult<ProviderCallbackEvent>>;
  updateCallbackNormalization(
    id: ProviderCallbackEventId,
    input: {
      normalizationStatus: CallbackNormalizationStatus;
      normalizationError?: string | null;
      sourceRecordId?: SourceRecordId | null;
    }
  ): Promise<
    ApplicationResult<{ type: 'callback_updated' | 'callback_not_found' }>
  >;
}
