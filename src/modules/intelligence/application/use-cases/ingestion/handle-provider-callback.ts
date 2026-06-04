import { Result } from '@swan-io/boxed';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import type { SourceRecordId, WorkspaceId } from '@/modules/kernel/domain/ids';
import type { JsonValue } from '@/modules/kernel/domain/json';

import type { IngestionDeps } from './types';
import { isProviderName } from '../../../domain/provider';
import type { ProviderCallbackContext } from '../../ports/provider-adapter';

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
    await deps.ingestionRepository.updateCallbackNormalization(eventId, {
      normalizationStatus: 'skipped',
    });
    return Result.Ok({
      type: 'callback_stored',
      normalized: false,
      sourceRecords: 0,
    });
  }

  let credential: string | undefined;
  if (isProviderName(input.providerName)) {
    const providerConfig = await deps.workspaceRepository.getProviderConfig(
      input.workspaceId,
      input.providerName
    );
    if (providerConfig.isOk()) {
      credential = deps.credentialResolver.resolve(
        providerConfig.get()?.credentialsRef ?? null
      );
    }
  }

  const context: ProviderCallbackContext = {
    workspaceId: input.workspaceId,
    credential,
    payload: input.payload,
    logger: deps.logger,
  };

  const normalization = await adapter.normalizeCallback(context);

  if (normalization.type === 'unsupported') {
    await deps.ingestionRepository.updateCallbackNormalization(eventId, {
      normalizationStatus: 'skipped',
    });
    return Result.Ok({
      type: 'callback_stored',
      normalized: false,
      sourceRecords: 0,
    });
  }

  if (normalization.type === 'invalid') {
    await deps.ingestionRepository.updateCallbackNormalization(eventId, {
      normalizationStatus: 'failed',
      normalizationError: normalization.reason,
    });
    return Result.Ok({
      type: 'callback_stored',
      normalized: false,
      sourceRecords: 0,
    });
  }

  let firstSourceRecordId: SourceRecordId | null = null;
  let count = 0;
  for (const record of normalization.sourceRecords) {
    const created = await deps.sourceRepository.createSourceRecord(record);
    if (created.isOk()) {
      count += 1;
      firstSourceRecordId ??= created.get().id;
    }
  }
  for (const searchResult of normalization.searchResults ?? []) {
    await deps.sourceRepository.createSearchResult(searchResult);
  }

  await deps.ingestionRepository.updateCallbackNormalization(eventId, {
    normalizationStatus: 'normalized',
    sourceRecordId: firstSourceRecordId,
  });

  return Result.Ok({
    type: 'callback_stored',
    normalized: true,
    sourceRecords: count,
  });
}
