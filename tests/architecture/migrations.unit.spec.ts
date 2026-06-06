import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrationsDir = path.join(root, 'drizzle', 'migrations');

function listSqlMigrations() {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => path.join(migrationsDir, file));
}

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findJsonbNotNullBackfillViolations() {
  return listSqlMigrations().flatMap((file) => {
    const source = fs.readFileSync(file, 'utf8');
    const lines = source.split('\n');
    const relative = path.relative(root, file);

    return lines.flatMap((line, index) => {
      const notNull = line.match(
        /ALTER TABLE "([^"]+)" ALTER COLUMN "([^"]+)" SET NOT NULL;/
      );
      if (!notNull) return [];

      const [, table, column] = notNull;
      const tablePattern = escaped(table ?? '');
      const columnPattern = escaped(column ?? '');
      const defaultPattern = new RegExp(
        `ALTER TABLE "${tablePattern}" ALTER COLUMN "${columnPattern}" SET DEFAULT '\\{\\}'::jsonb;`
      );
      if (!defaultPattern.test(source)) return [];

      const backfillPattern = new RegExp(
        `UPDATE "${tablePattern}" SET "${columnPattern}" = '\\{\\}'::jsonb WHERE "${columnPattern}" IS NULL;`
      );
      const priorSource = lines.slice(0, index).join('\n');
      return backfillPattern.test(priorSource)
        ? []
        : [`${relative}:${index + 1}:${table}.${column}`];
    });
  });
}

describe('migration guardrails', () => {
  it('backfills JSONB empty-object defaults before setting NOT NULL', () => {
    expect(findJsonbNotNullBackfillViolations()).toEqual([]);
  });
});
