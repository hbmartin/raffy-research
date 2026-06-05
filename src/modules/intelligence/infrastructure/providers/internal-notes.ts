import { Result } from '@swan-io/boxed';

import type { JsonValue } from '@/modules/kernel/domain/json';

import { fetchJson } from './http';
import { asArray, asObject, asString, pick } from './json-access';
import type {
  ProviderAdapter,
  ProviderDailyContext,
} from '../../application/ports/provider-adapter';
import type { SourceRecordWriteInput } from '../../domain/source';

const NOTION_API_VERSION = '2022-06-28';

const notesFor = (ctx: ProviderDailyContext, system: 'slack' | 'notion') =>
  ctx.internalNoteConfigs.filter(
    (note) => note.enabled && note.sourceSystem === system
  );

/** Slack: ingest recent messages from configured channels as internal evidence. */
export const slackAdapter: ProviderAdapter = {
  name: 'slack',
  isConfigured: ({ credential }) => Boolean(credential),
  async runDailyIngest(ctx) {
    if (!ctx.credential)
      return Result.Ok({ sourceRecords: [], searchResults: [] });
    const sourceRecords: SourceRecordWriteInput[] = [];

    for (const note of notesFor(ctx, 'slack')) {
      const response = await fetchJson(
        'slack',
        `https://slack.com/api/conversations.history?channel=${encodeURIComponent(note.sourceRef)}&limit=50`,
        { headers: { Authorization: `Bearer ${ctx.credential}` } }
      );
      if (response.isError()) continue;
      const body = asObject(response.get());
      if (body.ok === false) {
        ctx.logger.warn({
          event: 'intelligence.ingest.provider_error',
          details: {
            provider: 'slack',
            error: asString(body.error) ?? 'unknown',
          },
        });
        continue;
      }
      const messages = asArray(body.messages);
      for (const rawMessage of messages) {
        const message = asObject(rawMessage);
        const text = asString(message.text);
        if (!text) continue;
        sourceRecords.push({
          workspaceId: ctx.workspace.id,
          providerName: 'slack',
          providerSourceId: asString(message.ts),
          sourceType: 'slack_message',
          sourceName: `Slack ${note.sourceRef}`,
          authorOrAccount: asString(message.user),
          contentText: text,
          rawPayload: rawMessage,
          metadata: { channel: note.sourceRef },
        });
      }
    }
    return Result.Ok({ sourceRecords, searchResults: [] });
  },
};

const extractNotionText = (blocks: JsonValue[]): string =>
  blocks
    .map((rawBlock) => {
      const block = asObject(rawBlock);
      const type = asString(block.type);
      const content = type ? asObject(block[type]) : {};
      const richText = asArray(content.rich_text);
      return richText
        .map((rawSpan) => asString(pick(rawSpan, 'plain_text')) ?? '')
        .join('');
    })
    .filter((line) => line.length > 0)
    .join('\n');

/** Notion: ingest configured page content as internal evidence. */
export const notionAdapter: ProviderAdapter = {
  name: 'notion',
  isConfigured: ({ credential }) => Boolean(credential),
  async runDailyIngest(ctx) {
    if (!ctx.credential)
      return Result.Ok({ sourceRecords: [], searchResults: [] });
    const sourceRecords: SourceRecordWriteInput[] = [];

    for (const note of notesFor(ctx, 'notion')) {
      const response = await fetchJson(
        'notion',
        `https://api.notion.com/v1/blocks/${encodeURIComponent(note.sourceRef)}/children?page_size=100`,
        {
          headers: {
            Authorization: `Bearer ${ctx.credential}`,
            'Notion-Version': NOTION_API_VERSION,
          },
        }
      );
      if (response.isError()) continue;
      const blocks = asArray(pick(response.get(), 'results'));
      const text = extractNotionText(blocks);
      if (!text) continue;
      sourceRecords.push({
        workspaceId: ctx.workspace.id,
        providerName: 'notion',
        providerSourceId: note.sourceRef,
        sourceType: 'notion_page',
        sourceName: `Notion ${note.sourceRef}`,
        externalUrl: `https://www.notion.so/${note.sourceRef.replaceAll('-', '')}`,
        title: `Notion page ${note.sourceRef}`,
        contentText: text,
        rawPayload: response.get(),
        metadata: { page: note.sourceRef },
      });
    }
    return Result.Ok({ sourceRecords, searchResults: [] });
  },
};
