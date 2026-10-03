import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { z } from 'zod';

import { backfillCaptureHistory } from '@/modules/intelligence/backend';
import { getMigrationDatabaseConfig } from '@/modules/kernel/infrastructure/config/database';
import { parseEnv } from '@/modules/kernel/infrastructure/config/env-schema';
import {
  createDbClient,
  type Database,
} from '@/modules/kernel/infrastructure/db/client';
import {
  createMigrationDbClient,
  migrateDatabase,
} from '@/modules/kernel/infrastructure/db/migrate';
import { verifyMigrationPayloads } from '@/modules/kernel/infrastructure/db/migration-preservation';
import { backfillNewsletterHistory } from '@/modules/newsletter/backend';
import { readRuntimeEnv } from '@/platform/env/runtime-env';

export async function runWorkflowMigration(
  onProgress: (message: string) => void
) {
  const environment = parseEnv(
    z.object({
      NEWSLETTER_WORKERS_PAUSED: z.literal('true'),
      DATABASE_MIGRATION_URL: z.string().url(),
      WORKFLOW_OPERATOR_MAPPING_FILE: z.string().optional(),
    })
  );
  if (environment.NEWSLETTER_WORKERS_PAUSED !== 'true')
    throw new Error(
      'Stop ingestion and newsletter workers, disable cron, and set NEWSLETTER_WORKERS_PAUSED=true before migration'
    );
  if (!environment.DATABASE_MIGRATION_URL)
    throw new Error('An explicit DATABASE_MIGRATION_URL is required');
  const operators = environment.WORKFLOW_OPERATOR_MAPPING_FILE
    ? z
        .record(z.string(), z.string().min(1))
        .parse(
          JSON.parse(
            await readFile(environment.WORKFLOW_OPERATOR_MAPPING_FILE, 'utf8')
          )
        )
    : {};
  const migrationConfig = getMigrationDatabaseConfig({
    ...readRuntimeEnv(),
    DATABASE_URL: environment.DATABASE_MIGRATION_URL,
  });
  const migration = await createMigrationDbClient(migrationConfig);
  const directory = path.resolve('.local-ai-runs/migration-snapshots');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
  const digest = (value: unknown) =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex');
  let database: Database | undefined;
  try {
    const { rows: tables } = await migration.$client.query<{
      tablename: string;
    }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename"
    );
    const snapshot: Record<string, unknown[]> = {};
    for (const { tablename } of tables)
      snapshot[tablename] = (
        await migration.$client.query(
          `select to_jsonb(t) as payload from ${quote(tablename)} t order by to_jsonb(t)::text`
        )
      ).rows.map((r) => r.payload);
    const filename = path.join(
      directory,
      `${new Date().toISOString().replaceAll(':', '-')}.json.gz`
    );
    await writeFile(filename, gzipSync(JSON.stringify(snapshot)), {
      mode: 0o600,
    });
    onProgress(
      `Recoverable snapshot saved to ${filename}; SHA-256 ${digest(snapshot)}`
    );
    await migrateDatabase(migration);
    database = createDbClient({ url: environment.DATABASE_MIGRATION_URL });
    for (const operator of Object.values(operators)) {
      const { rows } = await database.$client.query(
        'select id from "user" where id = $1',
        [operator]
      );
      if (!rows.length)
        throw new Error('Operator mapping contains an unknown app user');
    }
    await database.$runInTransaction!(async (tx) => {
      const scoped = Object.assign(tx, {
        $runInTransaction: async (
          work: (client: typeof tx) => Promise<unknown>
        ) => work(tx),
      }) as unknown as Database;
      const captures = await backfillCaptureHistory(scoped);
      if (captures.isError()) throw captures.getError();
      const newsletters = await backfillNewsletterHistory(scoped, operators);
      if (newsletters.isError()) throw newsletters.getError();
      await verifyMigrationPayloads(
        tx,
        snapshot,
        [
          {
            table: 'sourceRecord',
            omittedColumns: [
              'canonicalUrl',
              'contentFingerprint',
              'contentLength',
              'normalizedFingerprint',
              'similarityBucket',
              'evidenceIdentity',
            ],
          },
          { table: 'weeklyReport', omittedColumns: [] },
        ],
        (snapshot.newsletterWorkspace ?? []).flatMap((row) => {
          const legacy = row as { state: { drafts: { id: string }[] } };
          return legacy.state.drafts.map((draft) => ({
            table: 'newsletterHistory',
            id: draft.id,
            payload: draft,
          }));
        })
      );
      onProgress(
        JSON.stringify({
          captures: captures.get(),
          newsletters: newsletters.get(),
          verification: 'counts and payload hashes preserved',
        })
      );
    });
  } finally {
    await database?.$close();
    await migration.$close();
  }
}
