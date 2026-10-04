import type { ApplicationResult } from '@/modules/kernel/application/result';

import type {
  Archive,
  EvidenceSource,
  JobSummary,
  NewsletterJob,
  NewsletterState,
  Runtime,
} from '../domain/newsletter';

export type Mutation<T> = {
  value: T;
  jobs?: NewsletterJob[];
  alreadyPresent?: T;
};
export type MutationContext = { activeSelectionIds: string[] };
export type NewsletterHistoryEntry = {
  id: string;
  kind: 'draft' | 'offer' | 'failure' | 'attempt' | 'retired';
  createdAt: string;
  reportId: string | null;
  selectionId: string | null;
  jobId: string;
  summary: string;
};
export interface NewsletterRepository {
  read(
    workspaceId: string,
    options?: { content?: boolean; drafts?: boolean }
  ): Promise<ApplicationResult<NewsletterState>>;
  getJob(
    workspaceId: string,
    jobId: string
  ): Promise<
    ApplicationResult<
      { type: 'job_found'; job: NewsletterJob } | { type: 'not_found' }
    >
  >;
  history(
    workspaceId: string,
    before?: string
  ): Promise<
    ApplicationResult<{
      type: 'history_found';
      entries: NewsletterHistoryEntry[];
      nextCursor: string | null;
    }>
  >;
  detail(
    workspaceId: string,
    id: string
  ): Promise<
    ApplicationResult<
      { type: 'detail_found'; payload: unknown } | { type: 'not_found' }
    >
  >;
  recordFailure(
    job: NewsletterJob,
    unit: string,
    failure: string,
    payload: unknown,
    leaseToken: string
  ): Promise<ApplicationResult<{ type: 'recorded' } | { type: 'lease_lost' }>>;
  pendingPublications(
    workspaceId?: string
  ): Promise<ApplicationResult<{ workspaceId: string; reportId: string }[]>>;
  mutate<T>(
    workspaceId: string,
    work: (
      state: NewsletterState,
      context: MutationContext
    ) => ApplicationResult<Mutation<T>>,
    lease?: { jobId: string; leaseToken: string },
    options?: { content?: boolean; drafts?: boolean }
  ): Promise<ApplicationResult<T>>;
  listJobs(
    workspaceId: string,
    options?: { summaries?: boolean }
  ): Promise<ApplicationResult<NewsletterJob[]>>;
  /** Active work oldest first, then completed attempts newest first; ID breaks ties. */
  listJobSummaries(
    workspaceId: string
  ): Promise<ApplicationResult<JobSummary[]>>;
  claim(
    mode: Runtime['mode'],
    now: Date,
    token: string,
    localOperatorId?: string
  ): Promise<
    ApplicationResult<
      { type: 'job_claimed'; job: NewsletterJob } | { type: 'queue_empty' }
    >
  >;
  checkpoint(
    job: NewsletterJob,
    values: Partial<
      Pick<
        NewsletterJob,
        'stage' | 'checkpoint' | 'status' | 'failure' | 'leaseUntil'
      >
    >,
    token: string
  ): Promise<
    ApplicationResult<{ type: 'job_updated' } | { type: 'lease_lost' }>
  >;
  enabledWorkspaces(): Promise<ApplicationResult<string[]>>;
}
export interface ResearchArchive {
  equivalenceReviews?(
    workspaceId: string,
    before?: string
  ): Promise<
    ApplicationResult<{
      type: 'reviews_found';
      reviews: {
        id: string;
        leftSourceId: string;
        rightSourceId: string;
        leftTitle: string;
        rightTitle: string;
        status: 'suggested' | 'confirmed' | 'separate';
      }[];
      nextCursor: string | null;
    }>
  >;
  decideEquivalence?(input: {
    workspaceId: string;
    reviewId: string;
    actorId: string;
    action: 'confirm' | 'separate' | 'reverse';
  }): Promise<
    ApplicationResult<
      | { type: 'saved' | 'not_found' | 'no_active_decision' }
      | import('@/modules/intelligence').EquivalenceConflict
    >
  >;
  read(
    workspaceId: string,
    options?: {
      sourceIds?: string[];
      reportIds?: string[];
      content?: boolean;
      now?: Date;
      jobId?: string;
      onlySourceIds?: boolean;
    }
  ): Promise<ApplicationResult<Archive | { type: 'workspace_not_found' }>>;
  research(input: {
    workspaceId: string;
    jobId: string;
    queries: string[];
    pages: number;
    timeoutMs: number;
    signal?: AbortSignal;
    deadline?: Date;
  }): Promise<ApplicationResult<EvidenceSource[]>>;
}
export interface NewsletterModel {
  generate(input: {
    runtime: Runtime;
    prompt: string;
    jobId: string;
    stage: string;
    signal?: AbortSignal;
    deadline?: Date;
    contextBudget?: number;
    maxOutputTokens?: number;
    timeoutMs?: number;
  }): Promise<ApplicationResult<string>>;
}
