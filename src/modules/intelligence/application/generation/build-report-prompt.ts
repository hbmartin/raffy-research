import type { WeeklyReportSummary } from '../../domain/report';
import type { SourceRecord } from '../../domain/source';
import type {
  Competitor,
  Keyword,
  SocialAccount,
  Workspace,
} from '../../domain/workspace';

export const REPORT_PROMPT_VERSION = 'v1';

/**
 * The hard V1 boundary: surface evidence and questions, never advise. The
 * generation prompt always includes this so the model cannot recommend actions.
 */
export const NO_RECOMMENDATION_GUIDANCE = [
  'You SURFACE, HIGHLIGHT, FRAME, ASK QUESTIONS, and POINT TO EVIDENCE.',
  'You MUST NOT recommend, prescribe, allocate budget, create tasks, or say "you should".',
  'Never tell the CEO to increase/reduce spend, launch a campaign, prioritize a channel, email leads, build a feature, or change positioning.',
  'Do not include confidence scores or confidence labels anywhere.',
].join(' ');

const truncate = (value: string | null | undefined, max: number): string =>
  !value ? '' : value.length > max ? `${value.slice(0, max)}…` : value;

const renderSource = (source: SourceRecord): string => {
  const lines = [
    `- id: ${source.id}`,
    `  type: ${source.sourceType}`,
    `  provider: ${source.providerName}`,
    source.title ? `  title: ${truncate(source.title, 200)}` : null,
    source.authorOrAccount ? `  author: ${source.authorOrAccount}` : null,
    source.externalUrl ? `  url: ${source.externalUrl}` : null,
    source.contentText
      ? `  content: ${truncate(source.contentText, 600)}`
      : null,
    source.diffAddedText
      ? `  added: ${truncate(source.diffAddedText, 300)}`
      : null,
    source.diffRemovedText
      ? `  removed: ${truncate(source.diffRemovedText, 300)}`
      : null,
  ];
  return lines.filter(Boolean).join('\n');
};

export type BuildReportPromptInput = {
  workspace: Workspace;
  keywords: Keyword[];
  competitors: Competitor[];
  socialAccounts: SocialAccount[];
  sources: SourceRecord[];
  priorReports: WeeklyReportSummary[];
  periodStartLabel: string;
  periodEndLabel: string;
};

export function buildReportPrompt(input: BuildReportPromptInput): string {
  const { workspace } = input;

  const competitorList = input.competitors
    .map((c) => `${c.name}${c.domain ? ` (${c.domain})` : ''} [${c.state}]`)
    .join(', ');
  const keywordList = input.keywords.map((k) => k.keywordString).join(', ');
  const socialList = input.socialAccounts
    .map((s) => s.profileUrl ?? `${s.platform ?? ''}/${s.username ?? ''}`)
    .join(', ');
  const priorList = input.priorReports
    .map((r) => `${r.title ?? 'Untitled'} (${r.status})`)
    .join('; ');

  const sourcesBlock =
    input.sources.length > 0
      ? input.sources.map(renderSource).join('\n')
      : '(no source records were captured this period)';

  return [
    'You are a market-intelligence analyst preparing a weekly digest for the CEO of a small, early-stage B2B SaaS company.',
    NO_RECOMMENDATION_GUIDANCE,
    '',
    '# Company context',
    `Company: ${workspace.companyName}`,
    `Subcategory: ${workspace.subcategory}`,
    `Description: ${workspace.companyDescription}`,
    workspace.positioning ? `Positioning: ${workspace.positioning}` : '',
    workspace.icp ? `ICP: ${workspace.icp}` : '',
    workspace.marketAssumptions
      ? `Internal market assumptions: ${workspace.marketAssumptions}`
      : '',
    workspace.gtmFocus ? `GTM focus: ${workspace.gtmFocus}` : '',
    `Tracked keywords: ${keywordList || '(none)'}`,
    `Tracked competitors: ${competitorList || '(none)'}`,
    `Monitored social accounts: ${socialList || '(none)'}`,
    '',
    `# Coverage window: ${input.periodStartLabel} to ${input.periodEndLabel}`,
    '',
    '# Source records (cite by their id in evidence.source_ids)',
    sourcesBlock,
    '',
    '# Prior reports (for trend labels ONLY — never cite as current-week evidence)',
    priorList || '(none)',
    '',
    '# Output requirements',
    'Respond with ONLY a single valid minified JSON object, no markdown fences, matching this shape:',
    '{ "title": string, "executive_summary": { "bullets": [string, string, string] },',
    '  "what_looks_most_interesting": [{ "id", "title", "summary", "why_this_may_matter", "evidence": [E] }],',
    '  "contradictions": [{ "id", "title", "internal_assumption", "external_signal", "observation", "evidence": [E] }],',
    '  "topic_clusters": [{ "id", "title", "summary", "observation", "why_this_may_matter",',
    '     "labels": { "newness": "new_this_week|existing", "trend": "rising|stable|declining|unknown" },',
    '     "representative_evidence": [E], "all_evidence": [E], "related_competitors": [string],',
    '     "related_keywords": [string], "related_internal_sources": [string] }],',
    '  "competitor_watch": [{ "id", "competitor_name", "domain", "change_type", "observation", "evidence": [E] }],',
    '  "suggested_competitors": [{ "id", "name", "domain", "why_suggested", "similarity", "related_keywords": [string], "evidence": [E] }],',
    '  "market_questions": [{ "id", "question", "source_type", "evidence": [E] }],',
    '  "possible_leads": [{ "id", "person_or_company", "source_excerpt", "why_relevant", "matched_keyword", "evidence": [E] }],',
    '  "social_product_feedback": [{ "id", "label": "direct_product|competitor_product|category|pain_point|social_reaction", "summary", "evidence": [E] }],',
    '  "source_library": [{ "source_id", "relation_type": "cited|relevant_unused", "topic_cluster_id", "source_title", "source_type", "provider_name", "external_url" }] }',
    'where E (an evidence item) = { "id", "source_ids": [string, ...], "excerpt", "source_title", "source_type", "provider_name", "external_url" }.',
    '',
    'Rules: executive_summary.bullets MUST have exactly 3 items. Every evidence item MUST include at least one source_id drawn from the source records above. Only include fixed sections that have new evidence; emit empty arrays otherwise. Deduplicate observations when multiple providers captured the same event. Market questions must be ACTUAL observed questions from the market, not your own prompts.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function buildRepairPrompt(input: {
  originalPrompt: string;
  invalidOutput: string;
  issues: string[];
}): string {
  return [
    'Your previous response was not valid against the required schema.',
    `Validation issues: ${input.issues.join('; ')}`,
    'Return ONLY corrected minified JSON matching the same shape. Do not add commentary.',
    '',
    'Previous response:',
    input.invalidOutput,
  ].join('\n');
}
