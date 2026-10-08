import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import type {
  BusinessOutcome,
  OperationKind,
  OperationStatus,
} from '../../domain/operation';

export const agentOperation = pgTable(
  'agentOperation',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspaceId').notNull(),
    userId: text('userId').notNull(),
    credentialId: text('credentialId').notNull(),
    kind: text('kind').$type<OperationKind>().notNull(),
    key: text('key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    input: jsonb('input').$type<Record<string, unknown>>().notNull(),
    checkpoint: jsonb('checkpoint')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: text('status').$type<OperationStatus>().notNull().default('queued'),
    stage: text('stage').notNull().default('queued'),
    leaseToken: text('leaseToken'),
    leaseUntil: timestamp('leaseUntil', {
      withTimezone: true,
      mode: 'date',
      precision: 3,
    }),
    cancelRequested: boolean('cancelRequested').notNull().default(false),
    result: jsonb('result').$type<BusinessOutcome>(),
    failure: text('failure'),
    parentId: text('parentId'),
    externalJobId: text('externalJobId'),
    createdAt: timestamp('createdAt', {
      withTimezone: true,
      mode: 'date',
      precision: 3,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('agentOperation_idempotency_idx').on(
      table.userId,
      table.workspaceId,
      table.key
    ),
    index('agentOperation_queue_idx').on(
      table.credentialId,
      table.status,
      table.createdAt
    ),
  ]
);

export const agentOperationEvent = pgTable(
  'agentOperationEvent',
  {
    id: text('id').primaryKey(),
    operationId: text('operationId')
      .notNull()
      .references(() => agentOperation.id, { onDelete: 'cascade' }),
    data: jsonb('data').$type<BusinessOutcome>().notNull(),
    createdAt: timestamp('createdAt', {
      withTimezone: true,
      mode: 'date',
      precision: 3,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('agentOperationEvent_page_idx').on(
      table.operationId,
      table.createdAt,
      table.id
    ),
  ]
);
