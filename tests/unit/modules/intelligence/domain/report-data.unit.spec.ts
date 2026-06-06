import { describe, expect, it } from 'vitest';

import {
  parseGeneratedReportJson,
  parseReportJson,
  validateReportData,
} from '@/modules/intelligence';

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

const validGeneratedReport = {
  title: validReport.title,
  executive_summary: validReport.executive_summary,
  topic_clusters: validReport.topic_clusters,
};

const getValidReportData = (result: ReturnType<typeof validateReportData>) => {
  if (result.type !== 'report_data_valid') {
    throw new Error(`expected report_data_valid, got ${result.type}`);
  }
  return result.data;
};

const getReportDataIssues = (result: ReturnType<typeof validateReportData>) => {
  if (result.type !== 'report_data_invalid') {
    throw new Error(`expected report_data_invalid, got ${result.type}`);
  }
  return result.issues;
};

const getGeneratedReportIssues = (
  result: ReturnType<typeof parseGeneratedReportJson>
) => {
  if (result.type !== 'generated_report_data_invalid') {
    throw new Error(
      `expected generated_report_data_invalid, got ${result.type}`
    );
  }
  return result.issues;
};

describe('report data validation', () => {
  it('accepts a minimal valid report and applies array defaults', () => {
    const data = getValidReportData(validateReportData(validReport));

    expect(data.what_looks_most_interesting).toEqual([]);
    expect(data.source_library).toEqual([]);
    expect(data.topic_clusters[0]?.all_evidence).toEqual([]);
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

  it('rejects forbidden keys before Zod can strip unknown object properties', () => {
    const result = validateReportData({
      ...validReport,
      confidence: 0.9,
      executive_summary: { bullets: ['a', 'b', 'c'], confidence: 'high' },
    });

    expect(result.type).toBe('report_data_invalid');
    expect(getReportDataIssues(result).join('\n')).toContain('confidence');
  });

  it('rejects forbidden keys in generated report JSON', () => {
    const result = parseGeneratedReportJson(
      JSON.stringify({
        ...validGeneratedReport,
        recommendation: 'launch campaign',
      })
    );

    expect(result.type).toBe('generated_report_data_invalid');
    expect(getGeneratedReportIssues(result).join('\n')).toContain(
      'recommendation'
    );
  });

  it('parses JSON with code fences and rejects malformed JSON', () => {
    const fenced = '```json\n' + JSON.stringify(validReport) + '\n```';
    expect(parseReportJson(fenced).type).toBe('report_data_valid');
    expect(parseReportJson('not json').type).toBe('report_data_invalid');
  });

  it('parses generated report JSON before system metadata exists', () => {
    const fenced = '```json\n' + JSON.stringify(validGeneratedReport) + '\n```';

    expect(parseGeneratedReportJson(fenced).type).toBe(
      'generated_report_data_valid'
    );
    expect(parseReportJson(fenced).type).toBe('report_data_invalid');
  });

  it('rejects unsafe generated report URLs', () => {
    const result = parseGeneratedReportJson(
      JSON.stringify({
        ...validGeneratedReport,
        topic_clusters: [
          {
            ...validGeneratedReport.topic_clusters[0],
            representative_evidence: [
              {
                id: 'e1',
                source_ids: ['src-1'],
                excerpt: 'x',
                external_url: 'javascript:alert(1)',
              },
            ],
          },
        ],
      })
    );

    expect(result.type).toBe('generated_report_data_invalid');
  });
});
