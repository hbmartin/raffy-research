import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import type { JudgmentProvenance } from '../../domain/judgment';

export const judgmentRecord = pgTable(
  'judgmentRecord',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspaceId').notNull(),
    targetId: text('targetId').notNull(),
    kind: text('kind')
      .$type<'rubric' | 'evaluation' | 'label' | 'editorial'>()
      .notNull(),
    provenance: jsonb('provenance').$type<JudgmentProvenance>().notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('createdAt', {
      withTimezone: true,
      mode: 'date',
      precision: 3,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('judgmentRecord_target_idx').on(
      table.workspaceId,
      table.targetId,
      table.createdAt,
      table.id
    ),
  ]
);
