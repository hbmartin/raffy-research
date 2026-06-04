import { describe, expect, it } from 'vitest';

import { parseReportJson, validateReportData } from '@/modules/intelligence';

const validReport = {
  workspace_id: 'ws-1',
  report_id: 'r-1',
  period_start: '2026-05-25',
  period_end: '2026-05-31',
  generated_at: '2026-06-01T15:00:00.000Z',
  timezone: 'America/Los_Angeles',
  title: 'Weekly Market Digest',
  executive_summary: { bullets: ['one', 'two', 'three'] },
  topic_clusters: [
    {
      id: 'topic_1',
      title: 'No-shows',
      summary: 's',
      observation: 'o',
      labels: { newness: 'new_this_week', trend: 'rising' },
      representative_evidence: [
        { id: 'e1', source_ids: ['src-1'], excerpt: 'x' },
      ],
    },
  ],
};

describe('report data validation', () => {
  it('accepts a minimal valid report and applies array defaults', () => {
    const result = validateReportData(validReport);
    expect(result.type).toBe('report_data_valid');
    if (result.type === 'report_data_valid') {
      expect(result.data.what_looks_most_interesting).toEqual([]);
      expect(result.data.source_library).toEqual([]);
      expect(result.data.topic_clusters[0]?.all_evidence).toEqual([]);
    }
  });

  it('requires exactly 3 executive summary bullets', () => {
    const result = validateReportData({
      ...validReport,
      executive_summary: { bullets: ['only', 'two'] },
    });
    expect(result.type).toBe('report_data_invalid');
  });

  it('requires every evidence item to carry source_ids', () => {
    const result = validateReportData({
      ...validReport,
      topic_clusters: [
        {
          ...validReport.topic_clusters[0],
          representative_evidence: [{ id: 'e1', source_ids: [], excerpt: 'x' }],
        },
      ],
    });
    expect(result.type).toBe('report_data_invalid');
  });

  it('strips disallowed confidence fields from stored data', () => {
    const result = validateReportData({
      ...validReport,
      confidence: 0.9,
      executive_summary: { bullets: ['a', 'b', 'c'], confidence: 'high' },
    });
    expect(result.type).toBe('report_data_valid');
    if (result.type === 'report_data_valid') {
      expect('confidence' in result.data).toBe(false);
      expect('confidence' in result.data.executive_summary).toBe(false);
    }
  });

  it('parses JSON with code fences and rejects malformed JSON', () => {
    const fenced = '```json\n' + JSON.stringify(validReport) + '\n```';
    expect(parseReportJson(fenced).type).toBe('report_data_valid');
    expect(parseReportJson('not json').type).toBe('report_data_invalid');
  });
});
