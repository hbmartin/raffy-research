import { z } from 'zod';

export const zRubricValues = z.object({
  relevance: z.number().int().min(1).max(5),
  accuracy: z.number().int().min(1).max(5),
  novelty: z.number().int().min(1).max(5),
  note: z.string().max(2000).optional(),
});
export const zEvaluation = z.object({
  scores: z.object({
    claim_support: z.number().int().min(1).max(5),
    coverage: z.number().int().min(1).max(5),
    noise: z.number().int().min(1).max(5),
  }),
  violations: z.array(
    z.object({
      section: z.string(),
      claim: z.string(),
      problem: z.enum([
        'unsupported',
        'misattributed',
        'contradicted',
        'irrelevant',
      ]),
      source_ids: z.array(z.string()),
    })
  ),
  missed_signals: z.array(
    z.object({ source_id: z.string(), why_it_matters: z.string() })
  ),
  summary: z.string(),
});
export type JudgmentOrigin = 'human' | 'assistant' | 'automated' | 'unknown';
export type JudgmentProvenance = {
  origin: JudgmentOrigin;
  channel?: 'web' | 'cli' | 'legacy';
  actorId?: string;
  credentialId?: string;
  agent?: string;
  model?: string;
  promptVersion?: string;
  rationale?: string;
  promotedFrom?: string;
};
