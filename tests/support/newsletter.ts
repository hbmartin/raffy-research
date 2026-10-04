import { Result } from '@swan-io/boxed';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { GeneratedId } from '@/modules/kernel/domain/ids';
import type {
  Mutation,
  NewsletterRepository,
  ResearchArchive,
} from '@/modules/newsletter';
import {
  type Article,
  type Audit,
  emptyState,
  type EvidenceSource,
  type NewsletterJob,
  type NewsletterProfile,
  type NewsletterState,
} from '@/modules/newsletter/testing';

export const newsletterNow = new Date('2026-10-02T12:00:00Z');
export const newsletterProfile: NewsletterProfile = {
  enabled: true,
  audience: 'Busy dental-industry insiders',
  guidance: 'Explain meaningful connections. 500–800 words.',
  samples: [
    'The signal is in the workflow, not the headline. Look at what actually changed.',
  ],
  halfLifeDays: 90,
  researchMinutes: 5,
  researchPages: 10,
  runtime: {
    mode: 'local',
    provider: 'codex-cli',
    model: 'fixture-model',
    contextWindowTokens: 128000,
    localOperatorId: 'reader',
  },
};
export const sourceFixture: EvidenceSource = {
  id: 'source-1',
  identity: 'original-study',
  url: 'https://example.org/study',
  title: 'Intent-aware scheduling study',
  content:
    'The study reports a 20% reduction in missed appointments across the participating clinics. The researchers recorded patient intent and used it to adapt appointment reminders.',
  publishedAt: '2026-10-01T12:00:00Z',
  capturedAt: '2026-10-01T12:00:00Z',
  reportIds: ['report-1'],
  authority: 1,
  junk: false,
  retracted: false,
};
export const articleFixture: Article = {
  subject: 'Scheduling is becoming a conversation',
  preview: 'What intent-aware reminders reveal about workflow innovation.',
  markdown:
    'The [study reports a 20% reduction](https://example.org/study) in missed appointments across participating clinics. The useful connection is the shift from generic reminders to an intent-aware workflow; its findings apply to these clinics rather than establishing an industry-wide outcome.',
  synthesis:
    'Connects appointment reminders with intent-aware workflows and qualifies the observed result.',
  claims: [
    {
      text: 'The study reports a 20% reduction in missed appointments across participating clinics.',
      sourceIds: ['source-1'],
      excerpts: [
        {
          sourceId: 'source-1',
          text: 'The study reports a 20% reduction in missed appointments across the participating clinics.',
        },
      ],
      kind: 'attributed',
    },
  ],
};
export const auditFixture: Audit = {
  supported: true,
  styleMatches: true,
  meaningfulSynthesis: true,
  counterevidenceRepresented: true,
  issues: [],
  claimChecks: articleFixture.claims.map((c) => ({
    text: c.text,
    supported: true,
    explanation:
      'The captured primary study supports the scoped, attributed result.',
  })),
};
export function stateFixture(): NewsletterState {
  return {
    ...emptyState(),
    profile: structuredClone(newsletterProfile),
    sources: [structuredClone(sourceFixture)],
    latestReportId: 'report-1',
    processedReports: ['report-1'],
    topics: [
      {
        id: 'topic-1',
        title: 'Intent-aware scheduling',
        summary: 'Scheduling workflows and patient intent.',
        sourceIds: ['source-1'],
        corrected: false,
      },
    ],
    angles: [
      {
        id: 'angle-1',
        topicId: 'topic-1',
        title: articleFixture.subject,
        takeaway: 'Intent-aware scheduling changes reminder workflows.',
        readerValue: articleFixture.synthesis,
        claims: structuredClone(articleFixture.claims),
        sourceIds: ['source-1'],
        gaps: [],
        counterevidence: [],
        verified: true,
        evidenceSignature: sourceFixture.identity,
      },
    ],
  };
}
export const archiveFixture: ResearchArchive = {
  async read() {
    return Result.Ok({
      workspaceId: 'ws-1',
      audienceSuggestion: newsletterProfile.audience,
      reports: [
        {
          id: 'report-1',
          publishedAt: newsletterNow.toISOString(),
          periodStart: '2026-09-21T00:00:00Z',
          sourceIds: ['source-1'],
        },
      ],
      sources: [structuredClone(sourceFixture)],
    });
  },
  async research() {
    return Result.Ok([]);
  },
};
export function memoryRepository(initial = stateFixture()) {
  let state = structuredClone(initial);
  const jobs: NewsletterJob[] = [];
  const failures: {
    id: string;
    payload: unknown;
    summary: string;
    createdAt: string;
    kind: 'failure';
    jobId: string;
    reportId: string | null;
    selectionId: string | null;
  }[] = [];
  let databaseNow = newsletterNow;
  const repository: NewsletterRepository = {
    async read() {
      return Result.Ok(structuredClone(state));
    },
    async mutate<T>(
      _workspaceId: string,
      work: (
        state: NewsletterState,
        context: { activeSelectionIds: string[] }
      ) => ApplicationResult<Mutation<T>>,
      lease?: { jobId: string; leaseToken: string }
    ) {
      if (
        lease &&
        !jobs.some(
          (j) =>
            j.workspaceId === _workspaceId &&
            j.id === lease.jobId &&
            j.leaseToken === lease.leaseToken &&
            j.status === 'running' &&
            j.leaseUntil &&
            j.leaseUntil > databaseNow
        )
      )
        return Result.Error(
          new AppError({
            code: 'NEWSLETTER_LEASE_LOST',
            category: 'system',
            status: 409,
            message: 'Lease lost',
          })
        );
      const next = structuredClone(state);
      const result = work(next, {
        activeSelectionIds: jobs
          .filter((j) => j.status === 'queued' || j.status === 'running')
          .flatMap((j) => (j.selectionId ? [j.selectionId] : [])),
      });
      if (result.isError()) return Result.Error(result.getError());
      if (
        result.get().jobs?.length &&
        result
          .get()
          .jobs!.every((job) => jobs.some((j) => j.key === job.key)) &&
        result.get().alreadyPresent !== undefined
      )
        return Result.Ok(result.get().alreadyPresent!);
      state = next;
      state.revision++;
      for (const job of result.get().jobs ?? [])
        if (!jobs.some((j) => j.key === job.key))
          jobs.push(structuredClone(job));
      return Result.Ok(result.get().value);
    },
    async listJobs() {
      return Result.Ok(structuredClone(jobs));
    },
    async listJobSummaries() {
      return Result.Ok(
        structuredClone(jobs).map(
          ({ checkpoint: _checkpoint, leaseToken: _token, ...summary }) =>
            summary
        )
      );
    },
    async getJob(workspaceId, jobId) {
      const job = jobs.find(
        (j) => j.workspaceId === workspaceId && j.id === jobId
      );
      return Result.Ok(
        job
          ? { type: 'job_found' as const, job: structuredClone(job) }
          : { type: 'not_found' as const }
      );
    },
    async pendingPublications() {
      return Result.Ok(
        state.profile?.enabled &&
          !jobs.some((j) => j.key === 'publication:ws-1:report-1')
          ? [{ workspaceId: 'ws-1', reportId: 'report-1' }]
          : []
      );
    },
    async history() {
      return Result.Ok({
        type: 'history_found' as const,
        entries: failures
          .map(({ payload: _payload, ...entry }) => entry)
          .slice(0, 20),
        nextCursor: null,
      });
    },
    async detail(_workspaceId, id) {
      const payload =
        state.drafts.find((d) => d.id === id) ??
        failures.find((f) => f.id === id)?.payload;
      return Result.Ok(
        payload
          ? { type: 'detail_found' as const, payload }
          : { type: 'not_found' as const }
      );
    },
    async recordFailure(job, unit, failure, payload, token) {
      if (
        !jobs.some(
          (j) =>
            j.id === job.id &&
            j.workspaceId === job.workspaceId &&
            j.leaseToken === token &&
            j.status === 'running' &&
            j.leaseUntil &&
            j.leaseUntil > databaseNow
        )
      )
        return Result.Ok({ type: 'lease_lost' as const });
      failures.push({
        id: `${job.id}:${unit}:${failures.length}`,
        payload,
        summary: failure,
        createdAt: databaseNow.toISOString(),
        kind: 'failure',
        jobId: job.id,
        reportId: job.targetReportId ?? null,
        selectionId: job.selectionId,
      });
      return Result.Ok({ type: 'recorded' as const });
    },
    async enabledWorkspaces() {
      return Result.Ok(state.profile?.enabled ? ['ws-1'] : []);
    },
    async claim(mode, now, token, localOperatorId) {
      databaseNow = now;
      if (mode === 'local' && !localOperatorId)
        return Result.Ok({ type: 'queue_empty' as const });
      const job = jobs.find(
        (j) =>
          j.runtime.mode === mode &&
          (mode !== 'local' || j.localOperatorId === localOperatorId) &&
          !jobs.some(
            (other) =>
              other.id !== j.id &&
              other.workspaceId === j.workspaceId &&
              other.status === 'running' &&
              other.leaseUntil &&
              other.leaseUntil > now
          ) &&
          (j.status === 'queued' ||
            (j.status === 'running' && j.leaseUntil && j.leaseUntil < now))
      );
      if (!job) return Result.Ok({ type: 'queue_empty' as const });
      Object.assign(job, {
        status: 'running',
        leaseToken: token,
        leaseUntil: new Date(now.getTime() + 120000),
      });
      return Result.Ok({
        type: 'job_claimed' as const,
        job: structuredClone(job),
      });
    },
    async checkpoint(job, values, token) {
      const live = jobs.find(
        (j) =>
          j.id === job.id &&
          j.workspaceId === job.workspaceId &&
          j.leaseToken === token &&
          j.status === 'running' &&
          j.leaseUntil &&
          j.leaseUntil > databaseNow
      );
      if (!live) return Result.Ok({ type: 'lease_lost' as const });
      Object.assign(live, values, {
        leaseUntil:
          values.status && values.status !== 'running'
            ? null
            : new Date(databaseNow.getTime() + 120000),
      });
      return Result.Ok({ type: 'job_updated' as const });
    },
  };
  return {
    repository,
    getState: () => structuredClone(state),
    getJobs: () => structuredClone(jobs),
    getFailures: () => structuredClone(failures),
  };
}
export function newsletterIds() {
  let next = 0;
  return { createId: () => `newsletter-${++next}` as GeneratedId };
}

export function requireOk<T>(result: ApplicationResult<T>): T {
  if (result.isError()) throw result.getError();
  return result.get();
}
export async function finishNewsletter(
  worker: {
    runNext(
      mode: 'local' | 'hosted'
    ): Promise<ApplicationResult<{ type: string }>>;
  },
  mode: 'local' | 'hosted' = 'local'
) {
  for (let step = 0; step < 40; step++) {
    if (requireOk(await worker.runNext(mode)).type === 'queue_empty') return;
  }
  throw new Error('Newsletter queue did not finish');
}
