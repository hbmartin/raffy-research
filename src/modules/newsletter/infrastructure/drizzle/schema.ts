import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { workspace } from '@/modules/intelligence/infrastructure/drizzle/schema';
import { createdAtColumn } from '@/modules/kernel/infrastructure/db/schema/common';

import type {
  NewsletterJob,
  NewsletterState,
  Runtime,
} from '../../domain/newsletter';

export const newsletterWorkspace = pgTable('newsletterWorkspace', {
  workspaceId: text('workspaceId')
    .primaryKey()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  state: jsonb('state').$type<NewsletterState>().notNull(),
});
export const newsletterJob = pgTable(
  'newsletterJob',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspaceId')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<NewsletterJob['kind']>().notNull(),
    key: text('key').notNull(),
    mode: text('mode').$type<Runtime['mode']>().notNull(),
    runtime: jsonb('runtime').$type<Runtime>().notNull(),
    selectionId: text('selectionId'),
    feedback: text('feedback').notNull().default(''),
    status: text('status')
      .$type<NewsletterJob['status']>()
      .notNull()
      .default('queued'),
    stage: text('stage').notNull().default('queued'),
    checkpoint: jsonb('checkpoint')
      .$type<NewsletterJob['checkpoint']>()
      .notNull()
      .default({}),
    leaseToken: text('leaseToken'),
    leaseUntil: timestamp('leaseUntil', { mode: 'date', precision: 3 }),
    failure: text('failure'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('newsletterJob_key_idx').on(table.key),
    index('newsletterJob_claim_idx').on(
      table.mode,
      table.status,
      table.leaseUntil
    ),
  ]
);
