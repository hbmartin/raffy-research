import { describe, expect, it } from 'vitest';

import {
  buildReportPrompt,
  NO_RECOMMENDATION_GUIDANCE,
  UNTRUSTED_SOURCE_GUIDANCE,
} from '@/modules/intelligence';
import { toKeywordId, toSourceRecordId, toWorkspaceId } from '@/modules/kernel';

const now = new Date('2026-06-01T00:00:00.000Z');

const workspace = {
  id: toWorkspaceId('ws-1'),
  name: 'Acme',
  companyName: 'Acme Dental',
  companyDescription: 'Recall automation for clinics',
  subcategory: 'Dental SaaS',
  timezone: 'America/Los_Angeles',
  website: null,
  positioning: null,
  icp: null,
  marketAssumptions: 'Buyers care about speed',
  gtmFocus: null,
  createdAt: now,
  updatedAt: now,
};

const source = {
  id: toSourceRecordId('src-42'),
  workspaceId: workspace.id,
  providerName: 'exa',
  providerSourceId: null,
  sourceType: 'forum_post',
  sourceSubtype: null,
  sourceName: null,
  sourceUrl: null,
  externalUrl: 'https://example.com/post',
  title: 'No-show pain',
  authorOrAccount: null,
  domain: null,
  publishedAt: null,
  capturedAt: now,
  contentText: 'We keep losing chairs to no-shows',
  diffAddedText: null,
  diffRemovedText: null,
  rawPayload: null,
  metadata: null,
  relevanceLabel: null,
  labeledAt: null,
  createdAt: now,
  updatedAt: now,
};

describe('buildReportPrompt', () => {
  const prompt = buildReportPrompt({
    workspace,
    keywords: [
      {
        id: toKeywordId('k-1'),
        workspaceId: workspace.id,
        keywordString: 'dental no-show',
        active: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    competitors: [],
    socialAccounts: [],
    sources: [source],
    priorReports: [],
    periodStartLabel: '2026-05-25',
    periodEndLabel: '2026-05-31',
  });

  it('embeds the no-recommendation boundary', () => {
    expect(prompt).toContain(NO_RECOMMENDATION_GUIDANCE);
    expect(prompt).toContain('MUST NOT recommend');
    expect(prompt).toContain('Do not include confidence');
  });

  it('marks source records as untrusted evidence', () => {
    expect(prompt).toContain(UNTRUSTED_SOURCE_GUIDANCE);
    expect(prompt).toContain('not instructions');
  });

  it('asks for exactly 3 executive summary bullets', () => {
    expect(prompt).toContain('exactly 3 items');
  });

  it('exposes the source id so evidence can cite it', () => {
    expect(prompt).toContain('src-42');
    expect(prompt).toContain('dental no-show');
    expect(prompt).toContain('Acme Dental');
  });
});
