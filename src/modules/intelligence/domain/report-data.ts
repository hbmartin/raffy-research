import { z } from 'zod';

import { isSafeHttpUrl, normalizeHttpUrl } from './url';

/**
 * The frozen weekly report JSON shape stored in `weeklyReport.reportData` and
 * rendered as the interactive CEO report page.
 *
 * V1 invariants enforced here:
 * - the executive summary has exactly 3 bullets,
 * - every evidence item carries one or more `source_ids`,
 * - fixed sections + emergent topic clusters are present,
 * - there are NO confidence fields and NO recommendation fields.
 *
 * Unknown forbidden keys (e.g. a model that emits `confidence`) are rejected
 * before Zod strips unknown object properties.
 */

export const zNewnessLabel = z.enum(['new_this_week', 'existing']);
export const zTrendLabel = z.enum(['rising', 'stable', 'declining', 'unknown']);

const zOptionalHttpUrl = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z
    .string()
    .trim()
    .refine(isSafeHttpUrl, { message: 'Must be an http(s) URL' })
    .transform((value) => normalizeHttpUrl(value) ?? value)
    .optional()
);

export const zEvidenceItem = z.object({
  id: z.string().min(1),
  source_ids: z.array(z.string().min(1)).min(1),
  excerpt: z.string(),
  source_title: z.string().optional(),
  source_type: z.string().optional(),
  provider_name: z.string().optional(),
  external_url: zOptionalHttpUrl,
  internal_source_url: zOptionalHttpUrl,
  notes: z.string().optional(),
});

const zExecutiveSummary = z.object({
  bullets: z.array(z.string().min(1)).length(3),
});

const zInterestingItem = z.object({
  id: z.string().min(1),
  title: z.string(),
  summary: z.string(),
  why_this_may_matter: z.string().optional(),
  evidence: z.array(zEvidenceItem).default([]),
});

const zContradiction = z.object({
  id: z.string().min(1),
  title: z.string(),
  internal_assumption: z.string().optional(),
  external_signal: z.string().optional(),
  observation: z.string(),
  evidence: z.array(zEvidenceItem).default([]),
});

const zTopicCluster = z.object({
  id: z.string().min(1),
  title: z.string(),
  summary: z.string(),
  observation: z.string(),
  why_this_may_matter: z.string().optional(),
  labels: z.object({
    newness: zNewnessLabel.default('existing'),
    trend: zTrendLabel.default('unknown'),
  }),
  representative_evidence: z.array(zEvidenceItem).default([]),
  all_evidence: z.array(zEvidenceItem).default([]),
  related_competitors: z.array(z.string()).default([]),
  related_keywords: z.array(z.string()).default([]),
  related_internal_sources: z.array(z.string()).default([]),
});

const zCompetitorWatchItem = z.object({
  id: z.string().min(1),
  competitor_name: z.string(),
  domain: z.string().optional(),
  change_type: z.string().optional(),
  observation: z.string(),
  evidence: z.array(zEvidenceItem).default([]),
});

const zSuggestedCompetitor = z.object({
  id: z.string().min(1),
  competitor_id: z.string().optional(),
  name: z.string(),
  domain: z.string().optional(),
  why_suggested: z.string(),
  similarity: z.string().optional(),
  mention_velocity: z.string().optional(),
  related_keywords: z.array(z.string()).default([]),
  evidence: z.array(zEvidenceItem).default([]),
});

const zMarketQuestion = z.object({
  id: z.string().min(1),
  question: z.string(),
  source_type: z.string().optional(),
  evidence: z.array(zEvidenceItem).default([]),
});

const zPossibleLead = z.object({
  id: z.string().min(1),
  person_or_company: z.string().optional(),
  source_excerpt: z.string(),
  why_relevant: z.string(),
  matched_keyword: z.string().optional(),
  matched_competitor: z.string().optional(),
  evidence: z.array(zEvidenceItem).default([]),
});

const zSocialProductFeedback = z.object({
  id: z.string().min(1),
  label: z.enum([
    'direct_product',
    'competitor_product',
    'category',
    'pain_point',
    'social_reaction',
  ]),
  summary: z.string(),
  evidence: z.array(zEvidenceItem).default([]),
});

const zSourceLibraryItem = z.object({
  source_id: z.string().min(1),
  relation_type: z.enum(['cited', 'relevant_unused']),
  topic_cluster_id: z.string().optional(),
  source_title: z.string().optional(),
  source_type: z.string().optional(),
  provider_name: z.string().optional(),
  external_url: zOptionalHttpUrl,
  internal_source_url: zOptionalHttpUrl,
});

const zReportContentShape = {
  title: z.string().min(1),
  executive_summary: zExecutiveSummary,
  what_looks_most_interesting: z.array(zInterestingItem).default([]),
  contradictions: z.array(zContradiction).default([]),
  topic_clusters: z.array(zTopicCluster).default([]),
  competitor_watch: z.array(zCompetitorWatchItem).default([]),
  suggested_competitors: z.array(zSuggestedCompetitor).default([]),
  market_questions: z.array(zMarketQuestion).default([]),
  possible_leads: z.array(zPossibleLead).default([]),
  social_product_feedback: z.array(zSocialProductFeedback).default([]),
  source_library: z.array(zSourceLibraryItem).default([]),
};

const forbiddenReportKeys = new Set([
  'confidence',
  'confidence_score',
  'confidenceScore',
  'recommendation',
  'recommendations',
  'recommended_action',
  'recommendedAction',
  'action_items',
  'actionItems',
]);

const forbiddenAdvicePhrases = [
  'you should',
  'we recommend',
  'i recommend',
  'increase spend',
  'reduce spend',
  'launch campaign',
  'prioritize this channel',
  'email these leads',
  'build this feature',
  'change positioning',
] as const;

const advicePhraseExcludedKeys = new Set([
  'id',
  'source_id',
  'source_ids',
  'source_title',
  'source_type',
  'provider_name',
  'external_url',
  'internal_source_url',
  'domain',
  'competitor_id',
  'excerpt',
  'source_excerpt',
]);

function findForbiddenReportKeys(value: unknown, path: string[] = []) {
  const issues: string[] = [];

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      issues.push(...findForbiddenReportKeys(item, [...path, String(index)]));
    }
    return issues;
  }

  if (typeof value !== 'object' || value === null) return issues;

  for (const [key, child] of Object.entries(value)) {
    if (forbiddenReportKeys.has(key)) {
      issues.push(
        `Report contains forbidden key "${[...path, key].join('.')}".`
      );
    }
    issues.push(...findForbiddenReportKeys(child, [...path, key]));
  }

  return issues;
}

function findForbiddenAdvicePhrases(value: unknown, path: string[] = []) {
  const issues: string[] = [];

  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    const phrase = forbiddenAdvicePhrases.find((candidate) =>
      normalized.includes(candidate)
    );
    if (phrase) {
      issues.push(`Report contains disallowed advice phrase "${phrase}".`);
    }
    return issues;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      issues.push(
        ...findForbiddenAdvicePhrases(item, [...path, String(index)])
      );
    }
    return issues;
  }

  if (typeof value !== 'object' || value === null) return issues;

  for (const [key, child] of Object.entries(value)) {
    if (advicePhraseExcludedKeys.has(key)) continue;
    issues.push(...findForbiddenAdvicePhrases(child, [...path, key]));
  }

  return issues;
}

function findForbiddenReportContent(value: unknown) {
  return [
    ...findForbiddenReportKeys(value),
    ...findForbiddenAdvicePhrases(value),
  ];
}

function addForbiddenReportContentIssues(value: unknown, ctx: z.RefinementCtx) {
  for (const issue of findForbiddenReportContent(value)) {
    ctx.addIssue({
      code: 'custom',
      message: issue,
    });
  }
}

export const zGeneratedReportData = z
  .object(zReportContentShape)
  .superRefine(addForbiddenReportContentIssues);

export const zReportData = z
  .object({
    workspace_id: z.string().min(1),
    report_id: z.string().min(1),
    period_start: z.string().min(1),
    period_end: z.string().min(1),
    generated_at: z.string().min(1),
    timezone: z.string().min(1),
    ...zReportContentShape,
  })
  .superRefine(addForbiddenReportContentIssues);

export type NewnessLabelValue = z.infer<typeof zNewnessLabel>;
export type TrendLabelValue = z.infer<typeof zTrendLabel>;
export type EvidenceItem = z.infer<typeof zEvidenceItem>;
export type TopicCluster = z.infer<typeof zTopicCluster>;
export type CompetitorWatchItem = z.infer<typeof zCompetitorWatchItem>;
export type SuggestedCompetitor = z.infer<typeof zSuggestedCompetitor>;
export type MarketQuestion = z.infer<typeof zMarketQuestion>;
export type PossibleLead = z.infer<typeof zPossibleLead>;
export type SocialProductFeedbackItem = z.infer<typeof zSocialProductFeedback>;
export type SourceLibraryItem = z.infer<typeof zSourceLibraryItem>;
export type InterestingItem = z.infer<typeof zInterestingItem>;
export type Contradiction = z.infer<typeof zContradiction>;
export type GeneratedReportData = z.infer<typeof zGeneratedReportData>;
export type ReportData = z.infer<typeof zReportData>;

export type GeneratedReportDataValidation =
  | { type: 'generated_report_data_valid'; data: GeneratedReportData }
  | { type: 'generated_report_data_invalid'; issues: string[] };

export type ReportDataValidation =
  | { type: 'report_data_valid'; data: ReportData }
  | { type: 'report_data_invalid'; issues: string[] };

const formatZodIssues = (
  issues: ReadonlyArray<{ path: readonly PropertyKey[]; message: string }>
) =>
  issues.map(
    (issue) =>
      `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`
  );

const formatForbiddenIssues = (input: unknown) =>
  findForbiddenReportContent(input).map((issue) => `<root>: ${issue}`);

const mergeIssues = (first: string[], second: string[]) => [
  ...new Set([...first, ...second]),
];

/** Validate unknown model-authored JSON before system metadata exists. */
export function validateGeneratedReportData(
  input: unknown
): GeneratedReportDataValidation {
  const result = zGeneratedReportData.safeParse(input);
  const forbiddenIssues = formatForbiddenIssues(input);
  if (result.success && forbiddenIssues.length === 0) {
    return { type: 'generated_report_data_valid', data: result.data };
  }
  return {
    type: 'generated_report_data_invalid',
    issues: mergeIssues(
      result.success ? [] : formatZodIssues(result.error.issues),
      forbiddenIssues
    ),
  };
}

/** Validate unknown report JSON against the V1 contract. Never throws. */
export function validateReportData(input: unknown): ReportDataValidation {
  const result = zReportData.safeParse(input);
  const forbiddenIssues = formatForbiddenIssues(input);
  if (result.success && forbiddenIssues.length === 0) {
    return { type: 'report_data_valid', data: result.data };
  }
  return {
    type: 'report_data_invalid',
    issues: mergeIssues(
      result.success ? [] : formatZodIssues(result.error.issues),
      forbiddenIssues
    ),
  };
}

const stripCodeFences = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;

  const openingFenceEnd = trimmed.indexOf('\n');
  if (openingFenceEnd < 0) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }

  const body = trimmed.slice(openingFenceEnd + 1).trim();
  if (!body.endsWith('```')) return body;
  return body.slice(0, -3).trim();
};

function parseJsonText(
  text: string
):
  | { type: 'json_valid'; value: unknown }
  | { type: 'json_invalid'; issues: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(text));
  } catch {
    return {
      type: 'json_invalid',
      issues: ['response was not valid JSON'],
    };
  }
  return { type: 'json_valid', value: parsed };
}

/** Parse and validate raw model text before system metadata exists. */
export function parseGeneratedReportJson(
  text: string
): GeneratedReportDataValidation {
  const parsed = parseJsonText(text);
  if (parsed.type === 'json_invalid') {
    return { type: 'generated_report_data_invalid', issues: parsed.issues };
  }
  return validateGeneratedReportData(parsed.value);
}

/** Parse and validate raw stored report JSON. Never throws. */
export function parseReportJson(text: string): ReportDataValidation {
  const parsed = parseJsonText(text);
  if (parsed.type === 'json_invalid') {
    return { type: 'report_data_invalid', issues: parsed.issues };
  }
  return validateReportData(parsed.value);
}
