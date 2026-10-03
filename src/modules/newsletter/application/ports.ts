import type { ApplicationResult } from '@/modules/kernel/application/result';

import type {
  Archive,
  EvidenceSource,
  NewsletterJob,
  NewsletterState,
  Runtime,
} from '../domain/newsletter';

export type Mutation<T> = { value: T; jobs?: NewsletterJob[] };
export interface NewsletterRepository {
  read(workspaceId: string): Promise<ApplicationResult<NewsletterState>>;
  mutate<T>(
    workspaceId: string,
    work: (state: NewsletterState) => ApplicationResult<Mutation<T>>,
    lease?: { jobId: string; leaseToken: string }
  ): Promise<ApplicationResult<T>>;
  listJobs(workspaceId: string): Promise<ApplicationResult<NewsletterJob[]>>;
  claim(
    mode: Runtime['mode'],
    now: Date,
    token: string
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
  read(
    workspaceId: string
  ): Promise<ApplicationResult<Archive | { type: 'workspace_not_found' }>>;
  research(input: {
    workspaceId: string;
    jobId: string;
    queries: string[];
    pages: number;
    timeoutMs: number;
  }): Promise<ApplicationResult<EvidenceSource[]>>;
}
export interface NewsletterModel {
  generate(input: {
    runtime: Runtime;
    prompt: string;
    jobId: string;
    stage: string;
  }): Promise<ApplicationResult<string>>;
}
