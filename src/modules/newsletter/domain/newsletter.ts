import { z } from 'zod';

import { markdownText } from './markdown';

export const DAY_MS = 86_400_000;
export const SCORING_POLICY = 'verified-support-momentum-v1';
export const zRuntime = z
  .object({
    mode: z.enum(['hosted', 'local']),
    provider: z.enum(['openai', 'codex-cli', 'claude-code', 'ollama']),
    model: z.string().trim().min(1).max(200),
    contextWindowTokens: z.number().int().min(8192).max(2_000_000).optional(),
    maxOutputTokens: z.number().int().positive().max(2_000_000).optional(),
    contextLimit: z
      .object({
        provider: z.enum(['openai', 'codex-cli', 'claude-code', 'ollama']),
        model: z.string().min(1),
        tokens: z.number().int().positive(),
        origin: z.enum(['known', 'discovered', 'declared', 'legacy']),
        operatorCeiling: z.number().int().positive().optional(),
      })
      .optional(),
    localOperatorId: z.string().min(1).optional(),
  })
  .refine(
    (v) =>
      v.mode === 'hosted' ? v.provider === 'openai' : v.provider !== 'openai',
    { message: 'Provider must match runtime' }
  );
export const zProfile = z.object({
  enabled: z.boolean(),
  audience: z.string().trim().min(1).max(4000),
  guidance: z.string().max(12000),
  samples: z.array(z.string().trim().min(1).max(30000)).max(10),
  halfLifeDays: z.number().int().min(1).max(730).default(90),
  researchMinutes: z.number().int().min(1).max(10).default(5),
  researchPages: z.number().int().min(1).max(30).default(10),
  runtime: zRuntime,
});
export type NewsletterProfile = z.infer<typeof zProfile>;
export type Runtime = NewsletterProfile['runtime'];
export type EvidenceSource = {
  id: string;
  identity: string;
  url: string;
  title: string;
  content: string;
  publishedAt: string;
  capturedAt: string;
  reportIds: string[];
  authority: number;
  authorityExplanation?: string;
  contentLength?: number;
  contentFingerprint?: string;
  originPublishedAt?: string;
  newsletterResearch?: boolean;
  researchJobId?: string;
  junk: boolean;
  retracted: boolean;
};
export type Archive = {
  workspaceId: string;
  audienceSuggestion: string;
  reports: {
    id: string;
    publishedAt: string;
    periodStart: string;
    periodEnd?: string;
    sourceIds: string[];
  }[];
  sources: EvidenceSource[];
};
export type TrackedTopic = {
  id: string;
  title: string;
  summary: string;
  sourceIds: string[];
  corrected: boolean;
  mergedInto?: string;
};
export const zClaim = z.object({
  text: z.string().min(1),
  sourceIds: z.array(z.string()).min(1),
  excerpts: z
    .array(z.object({ sourceId: z.string(), text: z.string().min(1) }))
    .min(1),
  kind: z.enum(['fact', 'attributed', 'interpretation']),
});
export type Claim = z.infer<typeof zClaim>;
export type EditorialAngle = {
  id: string;
  topicId: string;
  title: string;
  takeaway: string;
  readerValue: string;
  claims: Claim[];
  sourceIds: string[];
  gaps: string[];
  counterevidence: string[];
  verified: boolean;
  evidenceSignature: string;
  supportAudit?: Audit;
  auditSignature?: string;
  failed?: boolean;
};
export type Theme = EditorialAngle & {
  support: number;
  momentum: number;
  score: number;
  status: 'strong' | 'weak';
  explanation: string;
  policy: string;
  components: {
    verifiedClaims: number;
    centralClaims: number;
    distinctSources: number;
    latestFourteenDays: number;
    precedingFourteenDays: number;
    evidenceWeight: number;
    momentumWeight: number;
  };
  historicalDevelopment: {
    date: string;
    sourceId: string;
    reportIds: string[];
  }[];
};
export type Selection = {
  id: string;
  reportId: string;
  angleId: string;
  angleSnapshot?: EditorialAngle;
  selectedAt: string;
  snoozedUntil: string;
  status: 'pending' | 'ready' | 'failed' | 'abandoned';
  overrideReason: string;
  evidenceIdentities: string[];
  selectedBy: string;
};
export const zArticle = z.object({
  subject: z.string().min(1).max(250),
  preview: z.string().min(1).max(500),
  markdown: z.string().min(1).max(60000),
  synthesis: z.string().min(1),
  claims: z.array(zClaim).min(1),
});
export type Article = z.infer<typeof zArticle>;
export const zAudit = z.object({
  supported: z.boolean(),
  styleMatches: z.boolean(),
  meaningfulSynthesis: z.boolean(),
  counterevidenceRepresented: z.boolean(),
  issues: z.array(z.string()),
  claimChecks: z
    .array(
      z.object({
        text: z.string(),
        supported: z.boolean(),
        explanation: z.string(),
      })
    )
    .min(1),
});
export type Audit = z.infer<typeof zAudit>;
export type DraftVersion = Article & {
  id: string;
  selectionId: string;
  createdAt: string;
  profile: NewsletterProfile;
  feedback: string;
  audit: Audit;
  auditHistory?: Audit[];
  runtime: Runtime;
  sources: EvidenceSource[];
  jobId: string;
};
export type RetiredWorkingRecord = {
  entity: 'source' | 'topic' | 'angle';
  id: string;
  value: EvidenceSource | TrackedTopic | EditorialAngle;
};
export type NewsletterState = {
  retired?: RetiredWorkingRecord[];
  profile: NewsletterProfile | null;
  topics: TrackedTopic[];
  angles: EditorialAngle[];
  sources: EvidenceSource[];
  processedReports: string[];
  latestReportId: string | null;
  selections: Selection[];
  drafts: DraftVersion[];
  offers: Theme[];
  assignments?: Record<string, string>;
  skippedReports?: string[];
  offerHistory?: {
    jobId: string;
    reportId: string;
    createdAt: string;
    themes: Theme[];
  }[];
  revision: number;
};
export const emptyState = (): NewsletterState => ({
  profile: null,
  topics: [],
  angles: [],
  sources: [],
  processedReports: [],
  latestReportId: null,
  selections: [],
  drafts: [],
  offers: [],
  revision: 0,
});
export type JobKind = 'prepare' | 'draft';
export type GenerationBudget = {
  contextTokens: number;
  outputTokens: number;
  inputBytes: number;
  safetyTokens: number;
  origin: 'known' | 'discovered' | 'declared' | 'legacy';
  operatorCeiling?: number;
};
export type RepairUnitState = {
  candidateId?: string;
  repairsUsed: number;
  needsRepair: boolean;
  requestInFlight?: boolean;
  exhausted?: boolean;
  issues?: string[];
  rejected?: unknown;
  response?: { signature: string; text: string };
};
export type NewsletterJob = {
  id: string;
  workspaceId: string;
  kind: JobKind;
  key: string;
  runtime: Runtime;
  selectionId: string | null;
  feedback: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  stage: string;
  checkpoint: {
    version?: 2;
    terminalFailure?: { code: string; message: string; detailsJson: string };
    legacyRepairBlocked?: boolean;
    repairUnits?: Record<string, RepairUnitState>;
    styleAggregate?: {
      patterns: string;
      rules: { id: string; text: string }[];
    };
    profile?: NewsletterProfile;
    angle?: EditorialAngle;
    researchQueries?: string[];
    researchAssessed?: boolean;
    refreshCompleted?: boolean;
    repairFeedback?: string;
    audits?: Audit[];
    article?: Article;
    sources?: EvidenceSource[];
    researchStartedAt?: string;
    researchElapsedMs?: number;
    styleNotesReady?: boolean;
    evidencePrepared?: boolean;
    evidenceSlices?: import('./processing').ProcessingSlice[][];
    repairs?: number;
    unitRepairs?: Record<string, number>;
    unitFailures?: Record<string, string[]>;
    rejectedArticle?: Article;
    batchCursor?: number;
    processingBatches?: import('./processing').ProcessingBatch[];
    preparationSourceIds?: string[];
    preparedReportIds?: string[];
    styleCursor?: number;
    styleNotes?: string[];
    evidenceCursor?: number;
    evidenceInputSignature?: string;
    evidenceNotes?: {
      sourceId: string;
      passage: string;
      authority: number;
      explanation: string;
      counterevidence: string[];
    }[];
  };
  leaseToken: string | null;
  leaseUntil: Date | null;
  failure: string | null;
  createdAt: Date;
  targetReportId?: string | null;
  parentAttemptId?: string | null;
  initiatingActorId?: string | null;
  localOperatorId?: string | null;
  contextBudget?: number | null;
  budget?: GenerationBudget | null;
};
export type JobSummary = Omit<NewsletterJob, 'checkpoint' | 'leaseToken'>;
export const hasStyle = (profile: NewsletterProfile) =>
  Boolean(profile.guidance.trim() || profile.samples.length);

export function claimReferencesValid(
  claims: Claim[],
  sources: EvidenceSource[]
): boolean {
  const byId = new Map(sources.map((s) => [s.id, s]));
  return (
    claims.length > 0 &&
    claims.every(
      (claim) =>
        claim.sourceIds.length > 0 &&
        claim.sourceIds.every((id) => byId.has(id)) &&
        claim.sourceIds.every((id) =>
          claim.excerpts.some(
            (e) =>
              e.sourceId === id &&
              e.text.trim().length >= 12 &&
              byId.get(id)?.content.includes(e.text)
          )
        ) &&
        claim.excerpts.every(
          (e) =>
            claim.sourceIds.includes(e.sourceId) &&
            byId.get(e.sourceId)?.content.includes(e.text)
        )
    )
  );
}

export function auditPasses(article: Article, audit: Audit): boolean {
  return (
    audit.supported &&
    audit.styleMatches &&
    audit.meaningfulSynthesis &&
    audit.counterevidenceRepresented &&
    article.claims.every((claim) =>
      audit.claimChecks.some(
        (check) => check.text === claim.text && check.supported
      )
    )
  );
}

export function angleEligible(
  state: NewsletterState,
  angle: EditorialAngle,
  now: Date
): boolean {
  const uses = state.selections.filter(
    (s) =>
      s.angleId === angle.id && (s.status === 'pending' || s.status === 'ready')
  );
  if (uses.some((s) => new Date(s.snoozedUntil).getTime() > now.getTime()))
    return false;
  const lastUse = uses
    .filter((s) => s.status === 'ready')
    .sort((a, b) => b.selectedAt.localeCompare(a.selectedAt))[0];
  if (!lastUse) return true;
  return angle.sourceIds.some((id) => {
    const source = state.sources.find((s) => s.id === id);
    return (
      source &&
      !lastUse.evidenceIdentities.includes(source.identity) &&
      !source.junk &&
      !source.retracted &&
      angle.claims.some((claim) => claim.sourceIds.includes(source.id)) &&
      new Date(source.capturedAt).getTime() >
        new Date(lastUse.selectedAt).getTime()
    );
  });
}

export function rankThemes(
  state: NewsletterState,
  now: Date,
  includeSnoozed = false
): Theme[] {
  const halfLife = state.profile?.halfLifeDays ?? 90;
  const candidates = state.angles
    .filter((a) => !a.failed)
    .filter((a) => includeSnoozed || angleEligible(state, a, now))
    .map((angle): Theme => {
      const seen = new Set<string>();
      const available = state.sources
        .filter(
          (s) => angle.sourceIds.includes(s.id) && !s.junk && !s.retracted
        )
        .sort(
          (a, b) =>
            (b.contentLength ?? b.content.length) -
              (a.contentLength ?? a.content.length) ||
            a.publishedAt.localeCompare(b.publishedAt) ||
            a.id.localeCompare(b.id)
        );
      const sources = available.filter(
        (s) =>
          angle.sourceIds.includes(s.id) &&
          !s.junk &&
          !s.retracted &&
          !seen.has(s.identity) &&
          Boolean(seen.add(s.identity))
      );
      const support = sources.reduce(
        (sum, s) =>
          sum +
          s.authority *
            2 **
              (-Math.max(
                0,
                (now.getTime() -
                  new Date(s.originPublishedAt ?? s.publishedAt).getTime()) /
                  DAY_MS
              ) /
                halfLife),
        0
      );
      const topic = state.topics.find((t) => t.id === angle.topicId);
      const topicSeen = new Set<string>();
      const topicSources = state.sources.filter(
        (s) =>
          topic?.sourceIds.includes(s.id) &&
          !s.junk &&
          !s.retracted &&
          !topicSeen.has(s.identity) &&
          Boolean(topicSeen.add(s.identity))
      );
      const recent = topicSources.filter(
        (s) =>
          now.getTime() -
            new Date(s.originPublishedAt ?? s.publishedAt).getTime() >=
            0 &&
          now.getTime() -
            new Date(s.originPublishedAt ?? s.publishedAt).getTime() <
            14 * DAY_MS
      ).length;
      const previous = topicSources.filter(
        (s) =>
          now.getTime() -
            new Date(s.originPublishedAt ?? s.publishedAt).getTime() >=
            14 * DAY_MS &&
          now.getTime() -
            new Date(s.originPublishedAt ?? s.publishedAt).getTime() <
            28 * DAY_MS
      ).length;
      const momentum = (recent - previous) / Math.max(1, previous);
      const strong =
        angle.verified &&
        angle.gaps.length === 0 &&
        (available.every((s) => !s.content)
          ? angle.claims.every(
              (c) =>
                c.sourceIds.every((id) => available.some((s) => s.id === id)) &&
                c.excerpts.every((e) =>
                  available.some((s) => s.id === e.sourceId)
                )
            )
          : claimReferencesValid(angle.claims, available)) &&
        available.length > 0;
      return {
        ...angle,
        support,
        momentum,
        score: 0,
        status: strong ? 'strong' : 'weak',
        explanation: `${sources.length} distinct sources; ${recent} new sources in the latest 14 days versus ${previous} previously. Evidence half-life: ${halfLife} days.`,
        policy: SCORING_POLICY,
        components: {
          verifiedClaims:
            angle.supportAudit?.claimChecks.filter((c) => c.supported).length ??
            (angle.verified ? angle.claims.length : 0),
          centralClaims: angle.claims.length,
          distinctSources: sources.length,
          latestFourteenDays: recent,
          precedingFourteenDays: previous,
          evidenceWeight: 0.5,
          momentumWeight: 0.5,
        },
        historicalDevelopment: sources.map((s) => ({
          date: s.publishedAt,
          sourceId: s.id,
          reportIds: s.reportIds,
        })),
      };
    })
    .filter((t) => t.support > 0);
  const maxSupport = Math.max(1, ...candidates.map((c) => c.support));
  const maxMomentum = Math.max(
    1,
    ...candidates.map((c) => Math.max(0, c.momentum))
  );
  return candidates
    .map((t) => ({
      ...t,
      score:
        0.5 * (t.support / maxSupport) +
        0.5 * (Math.max(0, t.momentum) / maxMomentum),
    }))
    .sort(
      (a, b) =>
        Number(b.status === 'strong') - Number(a.status === 'strong') ||
        b.score - a.score ||
        b.support - a.support ||
        a.id.localeCompare(b.id)
    );
}

export function exportDraft(
  draft: DraftVersion,
  format: 'markdown' | 'text'
): string {
  const article =
    format === 'markdown' ? draft.markdown : markdownText(draft.markdown);
  return `Subject: ${draft.subject}\nPreview: ${draft.preview}\n\n${article}`;
}

export function sourceWarnings(
  draft: DraftVersion,
  current: EvidenceSource[]
): string[] {
  return draft.sources.flatMap((source) => {
    const live = current.find((s) => s.id === source.id);
    return !live || live.junk || live.retracted
      ? [
          `${source.title}: ${!live ? 'unavailable' : live.retracted ? 'retracted' : 'marked Junk'} since this version was created.`,
        ]
      : [];
  });
}
