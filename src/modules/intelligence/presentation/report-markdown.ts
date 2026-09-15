import type { WeeklyReport } from '../domain/report';
import type { EvidenceItem, ReportData } from '../domain/report-data';
import { normalizeHttpUrl } from '../domain/url';

const text = (value: string) =>
  value
    .trim()
    .replace(/\s*\n\s*/g, ' ')
    .replace(/([\\`*_{}[\]<>#|])/g, '\\$1');

const sourceReference = (source: {
  source_title?: string;
  provider_name?: string;
  external_url?: string;
  internal_source_url?: string;
}) => {
  const title = text(source.source_title ?? 'Source');
  const externalUrl = normalizeHttpUrl(source.external_url);
  const internalUrl = normalizeHttpUrl(source.internal_source_url);
  const primaryUrl = externalUrl ?? internalUrl;
  const references = [primaryUrl ? `[${title}](<${primaryUrl}>)` : title];

  if (externalUrl && internalUrl && internalUrl !== externalUrl) {
    references.push(`[Internal source](<${internalUrl}>)`);
  }

  if (source.provider_name) {
    references.push(`captured via ${text(source.provider_name)}`);
  }

  return references.join(' · ');
};

const evidenceLines = (items: EvidenceItem[]) =>
  items.map((item) => `- “${text(item.excerpt)}” — ${sourceReference(item)}`);

const allClusterEvidence = (cluster: ReportData['topic_clusters'][number]) => {
  const seen = new Set<string>();
  return [...cluster.representative_evidence, ...cluster.all_evidence].filter(
    (item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }
  );
};

const addEvidence = (lines: string[], items: EvidenceItem[]) => {
  if (items.length === 0) return;
  lines.push('**Evidence**', '', ...evidenceLines(items), '');
};

const addSection = (
  lines: string[],
  heading: string,
  entries: string[],
  emptyText = 'No new evidence this week.'
) => {
  lines.push(`## ${heading}`, '');
  lines.push(...(entries.length > 0 ? entries : [`_${emptyText}_`]));
  if (lines.at(-1) !== '') lines.push('');
};

const addOptionalField = (
  lines: string[],
  label: string,
  value: string | undefined
) => {
  if (value) lines.push(`**${label}:** ${text(value)}`, '');
};

export const formatReportAsMarkdown = (report: WeeklyReport): string => {
  const data = report.reportData;
  if (!data) return '';

  const title = report.title ?? data.title ?? 'Weekly Market Digest';
  const lines = [
    `# ${text(title)}`,
    '',
    `Coverage window: ${text(data.period_start)} – ${text(data.period_end)} (${text(report.timezone)})`,
    '',
  ];

  addSection(
    lines,
    'Executive Summary',
    data.executive_summary.bullets.map(
      (bullet, index) => `${index + 1}. ${text(bullet)}`
    )
  );

  const interesting: string[] = [];
  for (const item of data.what_looks_most_interesting) {
    interesting.push(`### ${text(item.title)}`, '', text(item.summary), '');
    addOptionalField(
      interesting,
      'Why this may matter',
      item.why_this_may_matter
    );
    addEvidence(interesting, item.evidence);
  }
  addSection(lines, 'What Looks Most Interesting', interesting);

  const contradictions: string[] = [];
  for (const item of data.contradictions) {
    contradictions.push(`### ${text(item.title)}`, '');
    addOptionalField(
      contradictions,
      'Internal assumption',
      item.internal_assumption
    );
    addOptionalField(contradictions, 'External signal', item.external_signal);
    contradictions.push(text(item.observation), '');
    addEvidence(contradictions, item.evidence);
  }
  addSection(lines, 'Contradictions / Assumptions to Revisit', contradictions);

  const clusters: string[] = [];
  for (const cluster of data.topic_clusters) {
    clusters.push(`### ${text(cluster.title)}`, '', text(cluster.summary), '');
    if (cluster.labels.newness === 'new_this_week') {
      clusters.push('**New this week**', '');
    }
    if (cluster.labels.trend !== 'unknown') {
      clusters.push(`**Trend:** ${text(cluster.labels.trend)}`, '');
    }
    clusters.push(text(cluster.observation), '');
    addOptionalField(
      clusters,
      'Why this may matter',
      cluster.why_this_may_matter
    );
    addEvidence(clusters, allClusterEvidence(cluster));
  }
  addSection(lines, 'Topic Clusters', clusters);

  const competitors: string[] = [];
  for (const item of data.competitor_watch) {
    competitors.push(`### ${text(item.competitor_name)}`, '');
    addOptionalField(
      competitors,
      'Change type',
      item.change_type?.replaceAll('_', ' ')
    );
    competitors.push(text(item.observation), '');
    addEvidence(competitors, item.evidence);
  }
  if (data.suggested_competitors.length > 0) {
    competitors.push('### Suggested competitors', '');
    for (const item of data.suggested_competitors) {
      competitors.push(`#### ${text(item.name)}`, '');
      addOptionalField(competitors, 'Domain', item.domain);
      competitors.push(text(item.why_suggested), '');
      if (item.similarity) competitors.push(text(item.similarity), '');
      addEvidence(competitors, item.evidence);
    }
  }
  addSection(lines, 'Competitor Watch', competitors);

  const questions: string[] = [];
  for (const item of data.market_questions) {
    questions.push(`### ${text(item.question)}`, '');
    addEvidence(questions, item.evidence);
  }
  addSection(
    lines,
    'Market Questions',
    questions,
    'No market questions captured this week.'
  );

  const leads: string[] = [];
  for (const item of data.possible_leads) {
    leads.push(`### ${text(item.person_or_company ?? 'Possible lead')}`, '');
    leads.push(
      `“${text(item.source_excerpt)}”`,
      '',
      text(item.why_relevant),
      ''
    );
    addOptionalField(leads, 'Matched keyword', item.matched_keyword);
    addEvidence(leads, item.evidence);
  }
  addSection(lines, 'Possible Leads', leads);

  const feedback: string[] = [];
  for (const item of data.social_product_feedback) {
    feedback.push(
      `### ${text(item.label.replaceAll('_', ' '))}`,
      '',
      text(item.summary),
      ''
    );
    addEvidence(feedback, item.evidence);
  }
  addSection(lines, 'Social / Product Feedback', feedback);

  addSection(
    lines,
    'Source Library',
    data.source_library.map(
      (item) =>
        `- ${sourceReference(item)} · ${item.relation_type === 'cited' ? 'Cited' : 'Relevant'}`
    ),
    'No sources are linked to this report.'
  );

  return lines.join('\n').trimEnd() + '\n';
};
