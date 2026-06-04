import type {
  NewFeedbackEvent,
  NewProviderConfig,
  NewSession,
  NewSourceRecord,
  NewUser,
  NewWeeklyReport,
  NewWeeklyReportSource,
  NewWorkspace,
  NewWorkspaceCompetitor,
  NewWorkspaceKeyword,
} from '@/modules/kernel/infrastructure/db/schema';

export const testTimestamps = {
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: new Date('2026-02-01T00:00:00.000Z'),
};

export const makeUserRow = (overrides: Partial<NewUser> = {}): NewUser => ({
  id: 'user-1',
  name: 'Test User',
  email: 'user@example.com',
  emailVerified: true,
  role: 'user',
  ...overrides,
});

export const makeSessionRow = (
  overrides: Partial<NewSession> = {}
): NewSession => ({
  id: 'session-1',
  token: 'token-1',
  userId: 'user-1',
  createdAt: testTimestamps.createdAt,
  updatedAt: testTimestamps.updatedAt,
  expiresAt: testTimestamps.expiresAt,
  ...overrides,
});

export const makeWorkspaceRow = (
  overrides: Partial<NewWorkspace> = {}
): NewWorkspace => ({
  id: 'workspace-1',
  name: 'Raffy Research',
  companyName: 'Raffy Research',
  companyDescription: 'CEO-facing weekly market intelligence digest.',
  subcategory: 'AI market intelligence',
  timezone: 'America/Los_Angeles',
  ...overrides,
});

export const makeWorkspaceKeywordRow = (
  overrides: Partial<NewWorkspaceKeyword> = {}
): NewWorkspaceKeyword => ({
  id: 'workspace-keyword-1',
  workspaceId: 'workspace-1',
  keywordString: 'AI research agents',
  ...overrides,
});

export const makeWorkspaceCompetitorRow = (
  overrides: Partial<NewWorkspaceCompetitor> = {}
): NewWorkspaceCompetitor => ({
  id: 'workspace-competitor-1',
  workspaceId: 'workspace-1',
  name: 'Signal Alpha',
  state: 'accepted',
  ...overrides,
});

export const makeProviderConfigRow = (
  overrides: Partial<NewProviderConfig> = {}
): NewProviderConfig => ({
  id: 'provider-config-1',
  workspaceId: 'workspace-1',
  providerName: 'exa',
  enabled: true,
  credentialsRef: 'EXA_API_KEY',
  config: { queries: ['AI research agents'] },
  ...overrides,
});

export const makeSourceRecordRow = (
  overrides: Partial<NewSourceRecord> = {}
): NewSourceRecord => ({
  id: 'source-record-1',
  workspaceId: 'workspace-1',
  providerName: 'exa',
  providerSourceId: 'exa-result-1',
  sourceType: 'web',
  title: 'Teams compare agent research workflows',
  externalUrl: 'https://example.com/research',
  contentText: 'Teams described shorter review cycles.',
  ...overrides,
});

export const makeWeeklyReportRow = (
  overrides: Partial<NewWeeklyReport> = {}
): NewWeeklyReport => ({
  id: 'weekly-report-1',
  workspaceId: 'workspace-1',
  periodStart: new Date('2026-06-01T00:00:00.000Z'),
  periodEnd: new Date('2026-06-08T00:00:00.000Z'),
  timezone: 'America/Los_Angeles',
  status: 'published',
  title: 'Weekly market intelligence digest',
  reportData: {
    workspace_id: 'workspace-1',
    report_id: 'weekly-report-1',
    period_start: '2026-06-01T00:00:00.000Z',
    period_end: '2026-06-08T00:00:00.000Z',
    generated_at: '2026-06-08T15:00:00.000Z',
    timezone: 'America/Los_Angeles',
    title: 'Weekly market intelligence digest',
    executive_summary: {
      bullets: ['One', 'Two', 'Three'],
    },
    what_looks_most_interesting: [],
    contradictions: [],
    topic_clusters: [],
    competitor_watch: [],
    suggested_competitors: [],
    market_questions: [],
    possible_leads: [],
    social_product_feedback: [],
    source_library: [],
  },
  ...overrides,
});

export const makeWeeklyReportSourceRow = (
  overrides: Partial<NewWeeklyReportSource> = {}
): NewWeeklyReportSource => ({
  id: 'weekly-report-source-1',
  workspaceId: 'workspace-1',
  reportId: 'weekly-report-1',
  sourceRecordId: 'source-record-1',
  relationType: 'cited',
  ...overrides,
});

export const makeFeedbackEventRow = (
  overrides: Partial<NewFeedbackEvent> = {}
): NewFeedbackEvent => ({
  id: 'feedback-event-1',
  workspaceId: 'workspace-1',
  reportId: 'weekly-report-1',
  eventType: 'useful',
  targetType: 'report_item',
  targetId: 'interesting-1',
  ...overrides,
});
