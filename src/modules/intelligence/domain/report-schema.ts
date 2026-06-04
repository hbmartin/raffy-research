import { z } from 'zod';

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

const evidenceItemSchema = z
  .object({
    id: z.string().min(1),
    source_ids: z.array(z.string().min(1)).min(1),
    excerpt: z.string().default(''),
    source_title: z.string().optional().default(''),
    source_type: z.string().optional().default(''),
    provider_name: z.string().optional().default(''),
    external_url: z.string().optional().default(''),
    internal_source_url: z.string().optional().default(''),
    notes: z.string().optional().default(''),
  })
  .strict();

const reportItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().optional().default(''),
    observation: z.string().optional().default(''),
    why_this_may_matter: z.string().optional().default(''),
    evidence: z.array(evidenceItemSchema).optional().default([]),
    representative_evidence: z.array(evidenceItemSchema).optional().default([]),
    all_evidence: z.array(evidenceItemSchema).optional().default([]),
    related_competitors: z.array(z.string()).optional().default([]),
    related_keywords: z.array(z.string()).optional().default([]),
    related_internal_sources: z.array(z.string()).optional().default([]),
    labels: z
      .object({
        newness: z.enum(['new_this_week', 'existing']).optional(),
        trend: z.enum(['rising', 'stable', 'declining', 'unknown']).optional(),
      })
      .optional()
      .default({}),
    notes: z.string().optional().default(''),
  })
  .strict();

const suggestedCompetitorSchema = reportItemSchema.extend({
  name: z.string().optional(),
  domain: z.string().optional(),
  why_suggested: z.string().optional(),
  similarity_to_workspace: z.string().optional(),
  mention_velocity: z.string().optional(),
  overlap_with_tracked_keywords: z.array(z.string()).optional().default([]),
});

export const reportDataSchema = z
  .object({
    workspace_id: z.string().min(1),
    report_id: z.string().min(1),
    period_start: z.string().min(1),
    period_end: z.string().min(1),
    generated_at: z.string().min(1),
    timezone: z.string().min(1),
    title: z.string().min(1),
    executive_summary: z
      .object({
        bullets: z.array(z.string().min(1)).length(3),
      })
      .strict(),
    what_looks_most_interesting: z.array(reportItemSchema).default([]),
    contradictions: z.array(reportItemSchema).default([]),
    topic_clusters: z.array(reportItemSchema).default([]),
    competitor_watch: z.array(reportItemSchema).default([]),
    suggested_competitors: z.array(suggestedCompetitorSchema).default([]),
    market_questions: z.array(reportItemSchema).default([]),
    possible_leads: z.array(reportItemSchema).default([]),
    social_product_feedback: z.array(reportItemSchema).default([]),
    source_library: z.array(reportItemSchema).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const issue of findForbiddenReportContent(value)) {
      ctx.addIssue({
        code: 'custom',
        message: issue,
      });
    }
  });

export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export type ReportData = z.infer<typeof reportDataSchema>;

export function parseReportData(value: unknown): ReportData {
  return reportDataSchema.parse(value);
}

function findForbiddenReportContent(value: unknown, path: string[] = []) {
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
        ...findForbiddenReportContent(item, [...path, String(index)])
      );
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
    issues.push(...findForbiddenReportContent(child, [...path, key]));
  }

  return issues;
}
