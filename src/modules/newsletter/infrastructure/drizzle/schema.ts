import {
  index,
  integer,
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
    leaseUntil: timestamp('leaseUntil', {
      mode: 'date',
      precision: 3,
      withTimezone: true,
    }),
    failure: text('failure'),
    createdAt: createdAtColumn(),
    targetReportId: text('targetReportId'),
    parentAttemptId: text('parentAttemptId'),
    initiatingActorId: text('initiatingActorId'),
    localOperatorId: text('localOperatorId'),
    contextBudget: integer('contextBudget'),
    budget: jsonb('budget').$type<NewsletterJob['budget']>(),
  },
  (table) => [
    uniqueIndex('newsletterJob_key_idx').on(table.key),
    index('newsletterJob_publication_idx').on(
      table.workspaceId,
      table.targetReportId
    ),
    index('newsletterJob_workspace_time_idx').on(
      table.workspaceId,
      table.createdAt
    ),
    index('newsletterJob_claim_idx').on(
      table.mode,
      table.status,
      table.leaseUntil
    ),
  ]
);

export const newsletterHistory = pgTable(
  'newsletterHistory',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspaceId')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    kind: text('kind')
      .$type<'draft' | 'offer' | 'failure' | 'attempt' | 'retired'>()
      .notNull(),
    jobId: text('jobId').notNull(),
    reportId: text('reportId'),
    selectionId: text('selectionId'),
    summary: text('summary').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('createdAt', {
      withTimezone: true,
      precision: 3,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('newsletterHistory_page_idx').on(
      table.workspaceId,
      table.createdAt,
      table.id
    ),
  ]
);

export const newsletterEvidence = pgTable(
  'newsletterEvidence',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspaceId')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    payload: jsonb('payload')
      .$type<import('../../domain/newsletter').EvidenceSource>()
      .notNull(),
  },
  (table) => [index('newsletterEvidence_workspace_idx').on(table.workspaceId)]
);
