import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { queryRowsSchema } from './query-rows';
import type { DbTransaction } from './types';
import { AppError } from '../../domain/errors/app-error';

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const verificationError = (message: string) =>
  new AppError({
    code: 'MIGRATION_PRESERVATION_FAILED',
    category: 'system',
    status: 500,
    message,
  });

/** Verify operator-selected original columns and immutable JSON payloads inside the backfill transaction. */
export async function verifyMigrationPayloads(
  transaction: DbTransaction,
  snapshot: Record<string, unknown[]>,
  preserved: { table: string; omittedColumns: string[] }[],
  immutable: { table: string; id: string; payload: unknown }[]
) {
  for (const { table, omittedColumns } of preserved) {
    const old = snapshot[table] as Record<string, unknown>[] | undefined;
    if (!old?.length) continue;
    const columns = Object.keys(old[0]!).filter(
      (key) => !omittedColumns.includes(key)
    );
    const result = queryRowsSchema(
      z.object({ payload: z.record(z.string(), z.unknown()) })
    ).parse(
      await transaction.execute(
        sql.raw(
          `select jsonb_build_object(${columns.map((key) => `'${key.replaceAll("'", "''")}', ${quote(key)}`).join(', ')}) as payload from ${quote(table)}`
        )
      )
    );
    const normalized = (rows: Record<string, unknown>[]) =>
      rows
        .map((row) =>
          JSON.stringify(
            Object.fromEntries(columns.map((key) => [key, row[key]]))
          )
        )
        .sort();
    if (
      digest(normalized(old)) !==
      digest(normalized(result.map((row) => row.payload)))
    )
      throw verificationError(
        `${table} count/payload verification failed; backfill rolled back`
      );
  }
  for (const { table, id, payload } of immutable) {
    const result = queryRowsSchema(z.object({ payload: z.unknown() })).parse(
      await transaction.execute(
        sql`select payload from ${sql.raw(quote(table))} where id = ${id}`
      )
    );
    if (digest(result[0]?.payload) !== digest(payload))
      throw verificationError(
        'Saved payload hash verification failed; backfill rolled back'
      );
  }
}
