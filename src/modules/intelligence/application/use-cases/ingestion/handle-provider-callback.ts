import { Result } from '@swan-io/boxed';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { SourceRecordId, WorkspaceId } from '@/modules/kernel/domain/ids';
import type { JsonValue } from '@/modules/kernel/domain/json';

import type { IngestionDeps } from './types';
import { isProviderName } from '../../../domain/provider';
import type {
  CallbackNormalization,
  ProviderCallbackContext,
} from '../../ports/provider-adapter';

export type HandleProviderCallbackInput = {
  providerName: string;
  workspaceId: WorkspaceId | null;
  payload: JsonValue;
};

export type HandleProviderCallbackOutcome = {
  type: 'callback_stored';
  normalized: boolean;
  sourceRecords: number;
};

/**
 * Store the raw provider callback payload first, then normalize to source
 * records when an adapter and workspace are available. Storage never fails the
 * caller even when normalization cannot proceed.
 */
export async function handleProviderCallback(
  deps: IngestionDeps,
  input: HandleProviderCallbackInput
): Promise<ApplicationResult<HandleProviderCallbackOutcome>> {
  const event = await deps.ingestionRepository.recordCallbackEvent({
    workspaceId: input.workspaceId,
    providerName: input.providerName,
    rawPayload: input.payload,
  });
  if (event.isError()) return Result.Error(event.getError());
  const eventId = event.get().id;

  const adapter = deps.registry.get(input.providerName);
  if (!adapter?.normalizeCallback || !input.workspaceId) {
    return updateCallbackAndReturn(deps, eventId, {
      normalizationStatus: 'skipped',
      outcome: { normalized: false, sourceRecords: 0 },
    });
  }

  const context: ProviderCallbackContext = {
    workspaceId: input.workspaceId,
    credential: await resolveCallbackCredential(
      deps,
      input.providerName,
      input.workspaceId
    ),
    payload: input.payload,
    logger: deps.logger,
  };

  const normalizationResult = await adapter.normalizeCallback(context);
  if (normalizationResult.isError()) {
    return Result.Error(normalizationResult.getError());
  }
  const normalization = normalizationResult.get();

  if (normalization.type === 'unsupported') {
    return updateCallbackAndReturn(deps, eventId, {
      normalizationStatus: 'skipped',
      outcome: { normalized: false, sourceRecords: 0 },
    });
  }

  if (normalization.type === 'invalid') {
    return updateCallbackAndReturn(deps, eventId, {
      normalizationStatus: 'failed',
      normalizationError: normalization.reason,
      outcome: { normalized: false, sourceRecords: 0 },
    });
  }

  const persisted = await persistCallbackNormalization(deps, normalization);
  if (persisted.isError()) return Result.Error(persisted.getError());
  const { count, firstSourceRecordId } = persisted.get();

  return updateCallbackAndReturn(deps, eventId, {
    normalizationStatus: 'normalized',
    sourceRecordId: firstSourceRecordId,
    outcome: { normalized: true, sourceRecords: count },
  });
}

async function resolveCallbackCredential(
  deps: IngestionDeps,
  providerName: string,
  workspaceId: WorkspaceId
): Promise<string | undefined> {
  if (!isProviderName(providerName)) return undefined;
  const providerConfig = await deps.workspaceRepository.getProviderConfig(
    workspaceId,
    providerName
  );
  if (providerConfig.isError()) return undefined;
  const outcome = providerConfig.get();
  if (outcome.type === 'provider_config_not_found') return undefined;
  return deps.credentialResolver.resolve(outcome.config.credentialsRef);
}

type PersistedCallbackNormalization = {
  count: number;
  firstSourceRecordId: SourceRecordId | null;
};

async function persistCallbackNormalization(
  deps: IngestionDeps,
  normalization: Extract<CallbackNormalization, { type: 'normalized' }>
): Promise<ApplicationResult<PersistedCallbackNormalization>> {
  let firstSourceRecordId: SourceRecordId | null = null;
  let count = 0;
  for (const record of normalization.sourceRecords) {
    const created = await deps.sourceRepository.createSourceRecord(record);
    if (created.isError()) {
      const error = created.getError();
      deps.logger.warn({
        event: 'intelligence.callback.source_record_create_failed',
        error: error.message,
        details: {
          errorCode: error.code,
          providerName: record.providerName,
          workspaceId: record.workspaceId,
        },
      });
      return Result.Error(error);
    }
    count += 1;
    firstSourceRecordId ??= created.get().id;
  }
  for (const searchResult of normalization.searchResults ?? []) {
    const created =
      await deps.sourceRepository.createSearchResult(searchResult);
    if (created.isError()) {
      const error = created.getError();
      deps.logger.warn({
        event: 'intelligence.callback.search_result_create_failed',
        error: error.message,
        details: {
          errorCode: error.code,
          providerName: searchResult.providerName,
          workspaceId: searchResult.workspaceId,
        },
      });
      return Result.Error(error);
    }
  }
  return Result.Ok({ count, firstSourceRecordId });
}

type CallbackNormalizationUpdate = Parameters<
  IngestionDeps['ingestionRepository']['updateCallbackNormalization']
>[1];

type CallbackStoredOutcomeInput = {
  normalizationStatus: CallbackNormalizationUpdate['normalizationStatus'];
  normalizationError?: string | null;
  sourceRecordId?: SourceRecordId | null;
  outcome: Omit<HandleProviderCallbackOutcome, 'type'>;
};

async function updateCallbackAndReturn(
  deps: IngestionDeps,
  eventId: Parameters<
    IngestionDeps['ingestionRepository']['updateCallbackNormalization']
  >[0],
  input: CallbackStoredOutcomeInput
): Promise<ApplicationResult<HandleProviderCallbackOutcome>> {
  const update: CallbackNormalizationUpdate = {
    normalizationStatus: input.normalizationStatus,
  };
  if ('normalizationError' in input) {
    update.normalizationError = input.normalizationError;
  }
  if ('sourceRecordId' in input) {
    update.sourceRecordId = input.sourceRecordId;
  }

  const updated = await updateCallbackNormalization(deps, eventId, update);
  if (updated.isError()) return Result.Error(updated.getError());
  return Result.Ok({ type: 'callback_stored', ...input.outcome });
}

async function updateCallbackNormalization(
  deps: IngestionDeps,
  eventId: Parameters<
    IngestionDeps['ingestionRepository']['updateCallbackNormalization']
  >[0],
  input: CallbackNormalizationUpdate
): Promise<ApplicationResult<undefined>> {
  const updated = await deps.ingestionRepository.updateCallbackNormalization(
    eventId,
    input
  );
  if (updated.isError()) return Result.Error(updated.getError());
  if (updated.get().type === 'callback_not_found') {
    return Result.Error(
      new AppError({
        code: 'INTELLIGENCE_CALLBACK_EVENT_MISSING',
        category: 'system',
        status: 500,
        message: 'Callback event vanished before normalization status update',
        details: { eventId },
      })
    );
  }
  return Result.Ok(undefined);
}
