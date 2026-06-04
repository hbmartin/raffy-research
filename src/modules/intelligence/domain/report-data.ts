import { z } from 'zod';

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
 * Unknown keys (e.g. a model that emits `confidence`) are stripped by Zod's
 * default object parsing, so stored report data never contains them.
 */

export const zNewnessLabel = z.enum(['new_this_week', 'existing']);
export const zTrendLabel = z.enum(['rising', 'stable', 'declining', 'unknown']);

export const zEvidenceItem = z.object({
  id: z.string().min(1),
  source_ids: z.array(z.string().min(1)).min(1),
  excerpt: z.string(),
  source_title: z.string().optional(),
  source_type: z.string().optional(),
  provider_name: z.string().optional(),
  external_url: z.string().optional(),
  internal_source_url: z.string().optional(),
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
  external_url: z.string().optional(),
  internal_source_url: z.string().optional(),
});

export const zReportData = z.object({
  workspace_id: z.string().min(1),
  report_id: z.string().min(1),
  period_start: z.string().min(1),
  period_end: z.string().min(1),
  generated_at: z.string().min(1),
  timezone: z.string().min(1),
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
});

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
export type ReportData = z.infer<typeof zReportData>;

export type ReportDataValidation =
  | { type: 'report_data_valid'; data: ReportData }
  | { type: 'report_data_invalid'; issues: string[] };

/** Validate unknown report JSON against the V1 contract. Never throws. */
export function validateReportData(input: unknown): ReportDataValidation {
  const result = zReportData.safeParse(input);
  if (result.success) {
    return { type: 'report_data_valid', data: result.data };
  }
  return {
    type: 'report_data_invalid',
    issues: result.error.issues.map(
      (issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`
    ),
  };
}

const stripCodeFences = (text: string): string =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

/** Parse and validate raw model text into report data. Never throws. */
export function parseReportJson(text: string): ReportDataValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(text));
  } catch {
    return {
      type: 'report_data_invalid',
      issues: ['response was not valid JSON'],
    };
  }
  return validateReportData(parsed);
}
