import { createPgliteTestDatabase } from '@tests/server/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { SourceRecordWriteInput } from '@/modules/intelligence';
import {
  createSourceRepository,
  intelligenceDrizzleSchema,
} from '@/modules/intelligence/testing';
import { toWorkspaceId } from '@/modules/kernel/domain/ids';

const workspaceId = toWorkspaceId('ws-1');
const capturedSince = new Date('2026-09-29T14:00:00.000Z');

const page = (
  overrides: Partial<SourceRecordWriteInput> = {}
): SourceRecordWriteInput => ({
  workspaceId,
  providerName: 'exa',
  sourceType: 'web_page',
  externalUrl: 'https://www.acme.example/blog/launch',
  contentText: 'Acme launches AI recall reminders.',
  capturedAt: new Date('2026-10-01T14:00:00.000Z'),
  ...overrides,
});

describe('source repository: excludeStoredCopies', () => {
  let database: Awaited<ReturnType<typeof createPgliteTestDatabase>>;

  beforeAll(async () => {
    database = await createPgliteTestDatabase();
  });
  beforeEach(async () => {
    await database.truncate();
    await database.db.insert(intelligenceDrizzleSchema.workspace).values({
      id: workspaceId,
      name: 'Workspace',
      companyName: 'Acme',
      companyDescription: 'Test workspace',
      subcategory: 'B2B SaaS',
      timezone: 'UTC',
    });
  });
  afterAll(async () => {
    await database?.close();
  });

  const repositoryWith = async (stored: SourceRecordWriteInput[]) => {
    const repository = createSourceRepository({ db: database.db });
    for (const record of stored) {
      const created = await repository.createSourceRecord(record);
      if (created.isError()) throw created.getError();
    }
    return repository;
  };

  const exclude = async (
    stored: SourceRecordWriteInput[],
    incoming: SourceRecordWriteInput
  ) => {
    const repository = await repositoryWith(stored);
    const result = await repository.excludeStoredCopies({
      workspaceId,
      providerName: 'exa',
      capturedSince,
      records: [incoming],
    });
    if (result.isError()) throw result.getError();
    return result.get();
  };

  it('drops an exact copy, even under a different spelling of the URL', async () => {
    const result = await exclude(
      [page()],
      page({
        externalUrl: 'https://acme.example/blog/launch/?utm_source=newsletter',
      })
    );
    expect(result).toEqual({ fresh: [], storedCopies: 1 });
  });

  it.each([
    {
      name: 'a page whose text changed (a new version)',
      stored: [page()],
      incoming: page({
        contentText: 'Acme launches AI recall reminders. Update: now GA.',
      }),
    },
    {
      name: 'a different page',
      stored: [page()],
      incoming: page({ externalUrl: 'https://acme.example/blog/pricing' }),
    },
    {
      name: 'a copy captured before the lookback',
      stored: [page({ capturedAt: new Date('2026-09-20T14:00:00.000Z') })],
      incoming: page(),
    },
    {
      name: 'a copy stored by another provider',
      stored: [page({ providerName: 'apify' })],
      incoming: page(),
    },
    {
      name: 'a record with no usable URL',
      stored: [page({ externalUrl: null })],
      incoming: page({ externalUrl: null }),
    },
  ])('keeps $name', async ({ stored, incoming }) => {
    const result = await exclude(stored, incoming);
    expect(result).toEqual({ fresh: [incoming], storedCopies: 0 });
  });
});
