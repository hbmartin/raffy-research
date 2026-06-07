import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import type { JsonObject, JsonValue } from '@/modules/kernel/domain/json';
import {
  createdAtColumn,
  idColumn,
  updatedAtColumn,
} from '@/modules/kernel/infrastructure/db/schema/common';

import type { ReportData } from '../../domain/report-data';

type JsonMetadata = JsonObject;

/** Customer/company environment. Root of all intelligence configuration. */
export const workspace = pgTable('workspace', {
  id: idColumn(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
  name: text('name').notNull(),
  companyName: text('companyName').notNull(),
  companyDescription: text('companyDescription').notNull(),
  subcategory: text('subcategory').notNull(),
  timezone: text('timezone').notNull().default('America/Los_Angeles'),
  website: text('website'),
  positioning: text('positioning'),
  icp: text('icp'),
  marketAssumptions: text('marketAssumptions'),
  gtmFocus: text('gtmFocus'),
  metadata: jsonb('metadata').$type<JsonMetadata>().notNull().default({}),
});

/** Plain configured keyword strings (V1 keeps keywords intentionally simple). */
export const workspaceKeyword = pgTable(
  'workspaceKeyword',
  {
    id: idColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    workspaceId: text('workspaceId')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    keywordString: text('keywordString').notNull(),
    active: boolean('active').notNull().default(true),
    metadata: jsonb('metadata').$type<JsonMetadata>().notNull().default({}),
  },
  (table) => [index('workspaceKeyword_workspaceId_idx').on(table.workspaceId)]
);

/** Monitored social accounts (profile URL OR platform+username). */
export const workspaceSocialAccount = pgTable(
  'workspaceSocialAccount',
  {
    id: idColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    workspaceId: text('workspaceId')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    platform: text('platform'),
    username: text('username'),
    profileUrl: text('profileUrl'),
    active: boolean('active').notNull().default(true),
    metadata: jsonb('metadata').$type<JsonMetadata>().notNull().default({}),
  },
  (table) => [
    index('workspaceSocialAccount_workspaceId_idx').on(table.workspaceId),
  ]
);

/** Known and suggested competitors. state: accepted | suggested | ignored. */
export const workspaceCompetitor = pgTable(
  'workspaceCompetitor',
  {
    id: idColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    workspaceId: text('workspaceId')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    domain: text('domain'),
    state: text('state')
      .$type<'accepted' | 'suggested' | 'ignored'>()
      .notNull()
      .default('accepted'),
    metadata: jsonb('metadata').$type<JsonMetadata>().notNull().default({}),
  },
  (table) => [
    index('workspaceCompetitor_workspaceId_idx').on(table.workspaceId),
  ]
);

/** Provider setup per workspace. Credentials are referenced by env key, never inlined. */
export const providerConfig = pgTable(
  'providerConfig',
  {
    id: idColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    workspaceId: text('workspaceId')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    providerName: text('providerName').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    credentialsRef: text('credentialsRef'),
    config: jsonb('config').$type<JsonMetadata>().notNull().default({}),
  },
  (table) => [
    uniqueIndex('providerConfig_workspace_provider_key').on(
      table.workspaceId,
      table.providerName
    ),
  ]
);

/** Configured Slack channels / Notion pages eligible as internal evidence. */
export const internalNoteConfig = pgTable(
  'internalNoteConfig',
  {
    id: idColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    workspaceId: text('workspaceId')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    sourceSystem: text('sourceSystem').$type<'slack' | 'notion'>().notNull(),
    sourceRef: text('sourceRef').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    metadata: jsonb('metadata').$type<JsonMetadata>().notNull().default({}),
  },
  (table) => [index('internalNoteConfig_workspaceId_idx').on(table.workspaceId)]
);

/** Permanently stored captured source objects. Duplicates are intentionally allowed. */
export const sourceRecord = pgTable(
  'sourceRecord',
  {
    id: idColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    workspaceId: text('workspaceId')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    providerName: text('providerName').notNull(),
    providerSourceId: text('providerSourceId'),
    sourceType: text('sourceType').notNull(),
    sourceSubtype: text('sourceSubtype'),
    sourceName: text('sourceName'),
    sourceUrl: text('sourceUrl'),
    externalUrl: text('externalUrl'),
    title: text('title'),
    authorOrAccount: text('authorOrAccount'),
    domain: text('domain'),
    publishedAt: timestamp('publishedAt', { precision: 3, mode: 'date' }),
    capturedAt: timestamp('capturedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow(),
    contentText: text('contentText'),
    diffAddedText: text('diffAddedText'),
    diffRemovedText: text('diffRemovedText'),
    rawPayload: jsonb('rawPayload').$type<JsonValue>().notNull().default({}),
    metadata: jsonb('metadata').$type<JsonMetadata>().notNull().default({}),
  },
  (table) => [
    index('sourceRecord_workspaceId_idx').on(table.workspaceId),
    index('sourceRecord_workspace_captured_idx').on(
      table.workspaceId,
      table.capturedAt
    ),
  ]
);

/** Search result items, stored separately from fetched source records. */
export const searchResult = pgTable(
  'searchResult',
  {
    id: idColumn(),
    createdAt: createdAtColumn(),
    workspaceId: text('workspaceId')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    providerName: text('providerName').notNull(),
    query: text('query').notNull(),
    resultRank: integer('resultRank'),
    title: text('title'),
    snippet: text('snippet'),
    url: text('url'),
    returnedAt: timestamp('returnedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow(),
    sourceRecordId: text('sourceRecordId').references(() => sourceRecord.id, {
      onDelete: 'set null',
    }),
    rawPayload: jsonb('rawPayload').$type<JsonValue>().notNull().default({}),
    metadata: jsonb('metadata').$type<JsonMetadata>().notNull().default({}),
  },
  (table) => [
    index('searchResult_workspaceId_idx').on(table.workspaceId),
    index('searchResult_sourceRecordId_idx').on(table.sourceRecordId),
  ]
);

/** Opportunistic source-level summaries/evidence candidates produced during synthesis. */
export const sourceSummary = pgTable(
  'sourceSummary',
  {
    id: idColumn(),
    createdAt: createdAtColumn(),
    workspaceId: text('workspaceId')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    sourceRecordId: text('sourceRecordId')
      .notNull()
      .references(() => sourceRecord.id, { onDelete: 'cascade' }),
    summaryText: text('summaryText'),
    evidenceCandidateText: text('evidenceCandidateText'),
    modelName: text('modelName'),
    modelProvider: text('modelProvider'),
    promptVersion: text('promptVersion'),
    inputMetadata: jsonb('inputMetadata')
      .$type<JsonMetadata>()
      .notNull()
      .default({}),
    outputPayload: jsonb('outputPayload')
      .$type<JsonValue>()
      .notNull()
      .default({}),
  },
  (table) => [
    index('sourceSummary_sourceRecordId_idx').on(table.sourceRecordId),
  ]
);

/** Frozen weekly report artifacts. status: generated | published | failed. */
export const weeklyReport = pgTable(
  'weeklyReport',
  {
    id: idColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    workspaceId: text('workspaceId')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    periodStart: timestamp('periodStart', {
      precision: 3,
      mode: 'date',
    }).notNull(),
    periodEnd: timestamp('periodEnd', { precision: 3, mode: 'date' }).notNull(),
    timezone: text('timezone').notNull(),
    status: text('status')
      .$type<'generated' | 'published' | 'failed'>()
      .notNull(),
    generatedAt: timestamp('generatedAt', { precision: 3, mode: 'date' }),
    publishedAt: timestamp('publishedAt', { precision: 3, mode: 'date' }),
    title: text('title'),
    reportData: jsonb('reportData').$type<ReportData | null>(),
    modelMetadata: jsonb('modelMetadata').$type<JsonMetadata | null>(),
    failureReason: text('failureReason'),
  },
  (table) => [
    // Multiple generation attempts per workspace-period are allowed; readers
    // select the newest published/report row by period and publishedAt.
    index('weeklyReport_workspaceId_idx').on(table.workspaceId),
    index('weeklyReport_workspace_period_idx').on(
      table.workspaceId,
      table.periodStart
    ),
    index('weeklyReport_workspace_published_idx').on(
      table.workspaceId,
      table.periodStart,
      table.publishedAt
    ),
  ]
);

/** Associates cited / relevant-but-unused source records with a report. */
export const weeklyReportSource = pgTable(
  'weeklyReportSource',
  {
    id: idColumn(),
    createdAt: createdAtColumn(),
    workspaceId: text('workspaceId')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    reportId: text('reportId')
      .notNull()
      .references(() => weeklyReport.id, { onDelete: 'cascade' }),
    sourceRecordId: text('sourceRecordId')
      .notNull()
      .references(() => sourceRecord.id, { onDelete: 'cascade' }),
    relationType: text('relationType')
      .$type<'cited' | 'relevant_unused'>()
      .notNull(),
    topicClusterId: text('topicClusterId'),
    sectionKey: text('sectionKey'),
    metadata: jsonb('metadata').$type<JsonMetadata>().notNull().default({}),
  },
  (table) => [
    index('weeklyReportSource_reportId_idx').on(table.reportId),
    index('weeklyReportSource_sourceRecordId_idx').on(table.sourceRecordId),
  ]
);

/** Append-only CEO feedback interactions. */
export const feedbackEvent = pgTable(
  'feedbackEvent',
  {
    id: idColumn(),
    createdAt: createdAtColumn(),
    workspaceId: text('workspaceId')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    reportId: text('reportId').references(() => weeklyReport.id, {
      onDelete: 'set null',
    }),
    userId: text('userId'),
    eventType: text('eventType').notNull(),
    targetType: text('targetType'),
    targetId: text('targetId'),
    sourceRecordId: text('sourceRecordId').references(() => sourceRecord.id, {
      onDelete: 'set null',
    }),
    payload: jsonb('payload').$type<JsonMetadata>().notNull().default({}),
  },
  (table) => [
    index('feedbackEvent_workspaceId_idx').on(table.workspaceId),
    index('feedbackEvent_reportId_idx').on(table.reportId),
    index('feedbackEvent_sourceRecordId_idx').on(table.sourceRecordId),
  ]
);

/** Records of scheduled/callback ingestion attempts for observability. */
export const ingestionRun = pgTable(
  'ingestionRun',
  {
    id: idColumn(),
    createdAt: createdAtColumn(),
    workspaceId: text('workspaceId').references(() => workspace.id, {
      onDelete: 'cascade',
    }),
    providerName: text('providerName').notNull(),
    runType: text('runType')
      .$type<'daily' | 'callback' | 'manual' | 'weekly'>()
      .notNull(),
    status: text('status')
      .$type<'started' | 'succeeded' | 'failed' | 'skipped'>()
      .notNull(),
    startedAt: timestamp('startedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finishedAt', { precision: 3, mode: 'date' }),
    itemsIngested: integer('itemsIngested').notNull().default(0),
    failureReason: text('failureReason'),
    metadata: jsonb('metadata').$type<JsonMetadata | null>(),
  },
  (table) => [index('ingestionRun_workspaceId_idx').on(table.workspaceId)]
);

/** Raw provider callback payloads, stored first then normalized when possible. */
export const providerCallbackEvent = pgTable(
  'providerCallbackEvent',
  {
    id: idColumn(),
    createdAt: createdAtColumn(),
    workspaceId: text('workspaceId').references(() => workspace.id, {
      onDelete: 'cascade',
    }),
    providerName: text('providerName').notNull(),
    rawPayload: jsonb('rawPayload').$type<JsonValue>().notNull().default({}),
    normalizationStatus: text('normalizationStatus')
      .$type<'pending' | 'normalized' | 'failed' | 'skipped'>()
      .notNull()
      .default('pending'),
    normalizationError: text('normalizationError'),
    sourceRecordId: text('sourceRecordId').references(() => sourceRecord.id, {
      onDelete: 'set null',
    }),
    receivedAt: timestamp('receivedAt', { precision: 3, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('providerCallbackEvent_provider_idx').on(table.providerName),
    index('providerCallbackEvent_workspace_received_idx')
      .on(table.workspaceId, table.receivedAt)
      .concurrently(),
  ]
);
