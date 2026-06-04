import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import {
  createdAtColumn,
  idColumn,
  updatedAtColumn,
} from '@/modules/kernel/infrastructure/db/schema/common';

const jsonbObject = (name: string) =>
  jsonb(name).$type<Record<string, unknown>>().default({}).notNull();

export const workspace = pgTable(
  'workspace',
  {
    id: idColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    name: text('name').notNull(),
    companyName: text('companyName').notNull(),
    companyDescription: text('companyDescription').notNull(),
    subcategory: text('subcategory').notNull(),
    timezone: text('timezone').default('America/Los_Angeles').notNull(),
    companyWebsite: text('companyWebsite'),
    currentPositioning: text('currentPositioning'),
    knownIcp: text('knownIcp'),
    knownMarketAssumptions: text('knownMarketAssumptions'),
    gtmFocusNotes: text('gtmFocusNotes'),
    metadata: jsonbObject('metadata'),
  },
  (table) => [index('workspace_company_name_idx').on(table.companyName)]
);

export const workspaceKeyword = pgTable(
  'workspace_keyword',
  {
    id: idColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    workspaceId: text('workspaceId')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    keywordString: text('keywordString').notNull(),
    active: boolean('active').default(true).notNull(),
    metadata: jsonbObject('metadata'),
  },
  (table) => [
    index('workspace_keyword_workspace_id_idx').on(table.workspaceId),
    index('workspace_keyword_active_idx').on(table.active),
  ]
);

export const workspaceSocialAccount = pgTable(
  'workspace_social_account',
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
    active: boolean('active').default(true).notNull(),
    metadata: jsonbObject('metadata'),
  },
  (table) => [
    index('workspace_social_account_workspace_id_idx').on(table.workspaceId),
  ]
);

export const workspaceCompetitor = pgTable(
  'workspace_competitor',
  {
    id: idColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    workspaceId: text('workspaceId')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    domain: text('domain'),
    state: text('state').default('accepted').notNull(),
    metadata: jsonbObject('metadata'),
  },
  (table) => [
    index('workspace_competitor_workspace_id_idx').on(table.workspaceId),
    index('workspace_competitor_state_idx').on(table.state),
  ]
);

export const providerConfig = pgTable(
  'provider_config',
  {
    id: idColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    workspaceId: text('workspaceId')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    providerName: text('providerName').notNull(),
    enabled: boolean('enabled').default(false).notNull(),
    credentialsRef: text('credentialsRef'),
    config: jsonbObject('config'),
  },
  (table) => [
    index('provider_config_workspace_id_idx').on(table.workspaceId),
    index('provider_config_provider_name_idx').on(table.providerName),
  ]
);

export const internalNoteConfig = pgTable(
  'internal_note_config',
  {
    id: idColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    workspaceId: text('workspaceId')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    sourceSystem: text('sourceSystem').notNull(),
    sourceRef: text('sourceRef').notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    metadata: jsonbObject('metadata'),
  },
  (table) => [
    index('internal_note_config_workspace_id_idx').on(table.workspaceId),
    index('internal_note_config_source_system_idx').on(table.sourceSystem),
  ]
);

export const sourceRecord = pgTable(
  'source_record',
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
      .defaultNow()
      .notNull(),
    contentText: text('contentText'),
    diffAddedText: text('diffAddedText'),
    diffRemovedText: text('diffRemovedText'),
    rawPayload: jsonbObject('rawPayload'),
    metadata: jsonbObject('metadata'),
  },
  (table) => [
    index('source_record_workspace_id_idx').on(table.workspaceId),
    index('source_record_provider_name_idx').on(table.providerName),
    index('source_record_captured_at_idx').on(table.capturedAt),
    index('source_record_source_type_idx').on(table.sourceType),
  ]
);

export const searchResult = pgTable(
  'search_result',
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
    url: text('url').notNull(),
    returnedAt: timestamp('returnedAt', { precision: 3, mode: 'date' })
      .defaultNow()
      .notNull(),
    sourceRecordId: text('sourceRecordId').references(() => sourceRecord.id, {
      onDelete: 'set null',
    }),
    rawPayload: jsonbObject('rawPayload'),
    metadata: jsonbObject('metadata'),
  },
  (table) => [
    index('search_result_workspace_id_idx').on(table.workspaceId),
    index('search_result_returned_at_idx').on(table.returnedAt),
  ]
);

export const sourceSummary = pgTable(
  'source_summary',
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
    inputMetadata: jsonbObject('inputMetadata'),
    outputPayload: jsonbObject('outputPayload'),
  },
  (table) => [
    index('source_summary_workspace_id_idx').on(table.workspaceId),
    index('source_summary_source_record_id_idx').on(table.sourceRecordId),
  ]
);

export const weeklyReport = pgTable(
  'weekly_report',
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
    status: text('status').notNull(),
    generatedAt: timestamp('generatedAt', { precision: 3, mode: 'date' }),
    publishedAt: timestamp('publishedAt', { precision: 3, mode: 'date' }),
    title: text('title'),
    reportData: jsonb('reportData').$type<unknown>().default({}).notNull(),
    modelMetadata: jsonbObject('modelMetadata'),
    failureReason: text('failureReason'),
  },
  (table) => [
    index('weekly_report_workspace_id_idx').on(table.workspaceId),
    index('weekly_report_status_idx').on(table.status),
    index('weekly_report_period_idx').on(table.periodStart, table.periodEnd),
  ]
);

export const weeklyReportSource = pgTable(
  'weekly_report_source',
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
    relationType: text('relationType').notNull(),
    topicClusterId: text('topicClusterId'),
    sectionKey: text('sectionKey'),
    metadata: jsonbObject('metadata'),
  },
  (table) => [
    index('weekly_report_source_report_id_idx').on(table.reportId),
    index('weekly_report_source_source_record_id_idx').on(table.sourceRecordId),
  ]
);

export const feedbackEvent = pgTable(
  'feedback_event',
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
    targetType: text('targetType').notNull(),
    targetId: text('targetId').notNull(),
    sourceRecordId: text('sourceRecordId').references(() => sourceRecord.id, {
      onDelete: 'set null',
    }),
    payload: jsonbObject('payload'),
  },
  (table) => [
    index('feedback_event_workspace_id_idx').on(table.workspaceId),
    index('feedback_event_report_id_idx').on(table.reportId),
    index('feedback_event_event_type_idx').on(table.eventType),
  ]
);

export const ingestionRun = pgTable(
  'ingestion_run',
  {
    id: idColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    workspaceId: text('workspaceId').references(() => workspace.id, {
      onDelete: 'cascade',
    }),
    providerName: text('providerName'),
    runType: text('runType').notNull(),
    status: text('status').notNull(),
    startedAt: timestamp('startedAt', { precision: 3, mode: 'date' })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp('finishedAt', { precision: 3, mode: 'date' }),
    failureReason: text('failureReason'),
    metadata: jsonbObject('metadata'),
  },
  (table) => [
    index('ingestion_run_workspace_id_idx').on(table.workspaceId),
    index('ingestion_run_status_idx').on(table.status),
  ]
);

export const providerCallbackEvent = pgTable(
  'provider_callback_event',
  {
    id: idColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    workspaceId: text('workspaceId').references(() => workspace.id, {
      onDelete: 'set null',
    }),
    providerName: text('providerName').notNull(),
    status: text('status').notNull(),
    receivedAt: timestamp('receivedAt', { precision: 3, mode: 'date' })
      .defaultNow()
      .notNull(),
    normalizedAt: timestamp('normalizedAt', { precision: 3, mode: 'date' }),
    failureReason: text('failureReason'),
    headers: jsonbObject('headers'),
    rawPayload: jsonbObject('rawPayload'),
    metadata: jsonbObject('metadata'),
  },
  (table) => [
    index('provider_callback_event_workspace_id_idx').on(table.workspaceId),
    index('provider_callback_event_provider_name_idx').on(table.providerName),
    index('provider_callback_event_status_idx').on(table.status),
  ]
);
