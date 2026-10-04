import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { match } from 'ts-pattern';

import { Badge } from '@/platform/components/ui/badge';
import { Button } from '@/platform/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/platform/components/ui/card';
import { Textarea } from '@/platform/components/ui/textarea';

import { ArticlePreview } from './article-preview';
import { DuplicateReview } from './duplicate-review';
import { NewsletterHistoryPanel } from './history-panel';
import { JobDetails } from './job-details';
import { NewsletterSettings } from './settings';
import { TopicCorrections } from './topic-corrections';
import { newsletterQueries } from './wired-queries';
import type {
  DraftVersion,
  EvidenceSource,
  NewsletterProfile,
  Theme,
} from '../domain/newsletter';
import {
  newsletterAbandon,
  newsletterCorrectTopic,
  newsletterExport,
  newsletterPrepareThemes,
  newsletterRegenerate,
  newsletterRetry,
  newsletterSaveProfile,
  newsletterSelect,
  newsletterSkip,
} from '../server';

type ActionResult = { type: string; message?: string };
const messages: Record<string, string> = {
  forbidden: 'You need permission to read reports.',
  style_required: 'Add house guidance or a writing sample before drafting.',
  selection_conflict:
    'Another reader already selected an angle for this report.',
  latest_report_required: 'Select themes from the latest report.',
  angle_unavailable: 'This theme is no longer available. Refresh the choices.',
  override_required: 'Provide a reason to reuse this angle.',
  invalid_correction: 'Check the topic title, target, and evidence selection.',
  context_required: 'Enter the context window for this custom model.',
  local_allocation_required: 'Configure OLLAMA_NUM_CTX for the local worker.',
  budget_invalid: 'The context cannot fit the chosen response cap and input.',
  not_found: 'This selection or draft is no longer available.',
};
function ThemeCard({
  theme,
  sources,
  onSelect,
  pending,
  override = false,
}: {
  theme: Theme;
  sources: EvidenceSource[];
  onSelect: (reason?: string) => void;
  pending: boolean;
  override?: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{theme.title}</CardTitle>
          <Badge variant={theme.status === 'strong' ? 'positive' : 'warning'}>
            {theme.status === 'strong' ? 'Supported' : 'Needs research'}
          </Badge>
        </div>
        <CardDescription>{theme.takeaway}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm">{theme.readerValue}</p>
        <p className="text-xs text-muted-foreground">{theme.explanation}</p>
        {theme.gaps.length ? (
          <ul className="list-inside list-disc text-sm text-warning-800">
            {theme.gaps.map((gap, i) => (
              <li key={`${i}:${gap}`}>{gap}</li>
            ))}
          </ul>
        ) : null}
        <details>
          <summary className="cursor-pointer text-sm">
            Evidence history ({theme.historicalDevelopment.length})
          </summary>
          <ul className="mt-2 text-xs">
            {theme.historicalDevelopment.map((h) => (
              <li key={h.sourceId}>
                {h.date.slice(0, 10)} · {h.reportIds.length} report associations
                ·{' '}
                <a
                  href={sources.find((s) => s.id === h.sourceId)?.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  {sources.find((s) => s.id === h.sourceId)?.title ?? 'Source'}
                </a>
              </li>
            ))}
          </ul>
          <ul className="mt-2 space-y-2 text-sm">
            {theme.claims.map((c, i) => (
              <li key={`${i}:${c.text}`}>
                <p>{c.text}</p>
                {c.excerpts.map((e, j) => (
                  <blockquote
                    key={`${j}:${e.sourceId}`}
                    className="border-l-2 pl-3 text-muted-foreground"
                  >
                    {e.text}
                    <a
                      className="ml-2 text-primary underline"
                      href={sources.find((s) => s.id === e.sourceId)?.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Original source
                    </a>
                  </blockquote>
                ))}
              </li>
            ))}
          </ul>
        </details>
        {theme.counterevidence.length ? (
          <details>
            <summary className="cursor-pointer text-sm">
              Counterevidence and limitations
            </summary>
            <ul className="mt-2 list-inside list-disc text-sm">
              {theme.counterevidence.map((c, i) => (
                <li key={`${i}:${c}`}>{c}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {override ? (
          <label className="text-sm">
            Reason for deliberate reuse
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        ) : null}
        <Button
          disabled={pending || (override && !reason.trim())}
          className="self-start"
          onClick={() => onSelect(override ? reason : undefined)}
        >
          {override
            ? 'Reuse with recorded reason'
            : theme.status === 'weak'
              ? 'Research and draft this theme'
              : 'Draft this theme'}
        </Button>
      </CardContent>
    </Card>
  );
}
function SavedDraft({
  draft,
  warnings,
  onExport,
  onRegenerate,
  pending,
  canRegenerate,
}: {
  draft: DraftVersion;
  warnings: string[];
  onExport: (format: 'markdown' | 'text') => void;
  onRegenerate: (feedback: string) => void;
  pending: boolean;
  canRegenerate: boolean;
}) {
  const [feedback, setFeedback] = useState('');
  return (
    <article className="flex flex-col gap-3 rounded-md border p-4">
      <h3 className="text-lg font-semibold">{draft.subject}</h3>
      <p className="text-sm text-muted-foreground">{draft.preview}</p>
      <p className="text-xs text-muted-foreground">
        {new Date(draft.createdAt).toLocaleString()} · {draft.runtime.provider}{' '}
        · {draft.runtime.model}
      </p>
      {warnings.length ? (
        <div
          role="status"
          className="rounded-md border border-warning-200 p-3 text-sm"
        >
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          <p>This saved version remains exportable.</p>
        </div>
      ) : null}
      <ArticlePreview markdown={draft.markdown} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => onExport('markdown')}
        >
          Export Markdown
        </Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => onExport('text')}
        >
          Export plain text
        </Button>
      </div>
      <details>
        <summary className="cursor-pointer text-sm">
          Claim and synthesis audit
        </summary>
        <p className="mt-2 text-sm">{draft.synthesis}</p>
        <ul className="mt-2 space-y-2 text-sm">
          {draft.audit.claimChecks.map((c, i) => (
            <li key={`${i}:${c.text}`}>
              <strong>{c.text}</strong>
              <p>{c.explanation}</p>
            </li>
          ))}
        </ul>
        <ul className="mt-2 text-sm">
          {draft.sources.map((s) => (
            <li key={s.id}>
              <a
                className="text-primary underline"
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {s.title}
              </a>{' '}
              · {s.publishedAt.slice(0, 10)} · {s.reportIds.length} originating
              report associations
            </li>
          ))}
        </ul>
        <ul className="mt-3 space-y-3 text-sm">
          {draft.claims.map((claim, i) => (
            <li key={`${i}:${claim.text}`}>
              <p>
                {claim.text} · {claim.kind}
              </p>
              {claim.excerpts.map((excerpt, j) => (
                <blockquote
                  key={`${j}:${excerpt.sourceId}`}
                  className="mt-1 border-l-2 pl-3 text-muted-foreground"
                >
                  {excerpt.text}{' '}
                  <a
                    className="text-primary underline"
                    href={
                      draft.sources.find((s) => s.id === excerpt.sourceId)?.url
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Supporting source
                  </a>
                </blockquote>
              ))}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary className="cursor-pointer text-sm">
          Version guidance and audit history
        </summary>
        <div className="mt-2 space-y-2 text-sm break-words whitespace-pre-wrap">
          <p>Audience: {draft.profile.audience}</p>
          <p>
            House guidance:{' '}
            {draft.profile.guidance ||
              'Writing samples supplied the house style.'}
          </p>
          {draft.profile.samples.map((sample, i) => (
            <details key={i}>
              <summary>Writing sample {i + 1}</summary>
              <p>{sample}</p>
            </details>
          ))}
          {draft.feedback ? <p>Version feedback: {draft.feedback}</p> : null}
          {(draft.auditHistory ?? [draft.audit]).map((audit, i) => (
            <p key={i}>
              Audit pass {i + 1}:{' '}
              {audit.issues.length
                ? audit.issues.join('; ')
                : 'Support, style, synthesis, and counterevidence checks passed.'}
            </p>
          ))}
        </div>
      </details>
      {canRegenerate ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onRegenerate(feedback);
          }}
        >
          <label className="text-sm">
            Feedback for a new version
            <Textarea
              required
              maxLength={12000}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Tighten the opening, explain the connection, reduce jargon…"
            />
          </label>
          <Button type="submit" className="self-start" disabled={pending}>
            Regenerate with feedback
          </Button>
        </form>
      ) : null}
    </article>
  );
}

export function NewsletterPanel({
  workspaceId,
  reportId,
}: {
  workspaceId: string;
  reportId: string;
}) {
  const queryClient = useQueryClient();
  const query = useQuery(newsletterQueries.workspace(workspaceId));
  const mutation = useMutation({
    mutationFn: async ({
      run,
    }: {
      run: () => Promise<ActionResult>;
      success: string;
    }) => run(),
    onSuccess: async (result, input) => {
      match(result.type)
        .with('saved', 'queued', () => toast.success(input.success))
        .otherwise((type) =>
          toast.error(
            result.message ??
              messages[type] ??
              'The action could not be completed.'
          )
        );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: newsletterQueries.workspace(workspaceId).queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: newsletterQueries.history(workspaceId).queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: newsletterQueries
            .detail(workspaceId, '')
            .queryKey.slice(0, 2),
        }),
      ]);
    },
    onError: () =>
      toast.error('Newsletter action failed. Your saved drafts are preserved.'),
  });
  const data = query.data;
  const run = (
    fn: () => Promise<ActionResult>,
    success = 'Newsletter action completed'
  ) => mutation.mutate({ run: fn, success });
  if (query.isPending)
    return (
      <section aria-label="Newsletter" className="rounded-md border p-4">
        <p>Loading newsletter…</p>
      </section>
    );
  if (query.isError)
    return (
      <section aria-label="Newsletter" className="rounded-md border p-4">
        <p>Newsletter could not be loaded.</p>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </section>
    );
  if (!data || data.type !== 'newsletter_found') return null;
  const state = data.state;
  const latest = state.latestReportId === reportId;
  const selection = state.selections.find(
    (s) =>
      s.reportId === reportId &&
      (s.status === 'pending' || s.status === 'ready')
  );
  const busyJobs = data.jobs.filter(
    (j) => j.status === 'queued' || j.status === 'running'
  );
  const failedJobs = data.jobs.filter((j) => j.status === 'failed');
  const exportVersion = async (
    draft: DraftVersion,
    format: 'markdown' | 'text'
  ) => {
    try {
      const result = await newsletterExport({
        data: { workspaceId, draftId: draft.id, format },
      });
      if (result.type !== 'draft_exported') {
        toast.error('Draft export unavailable');
        return;
      }
      if (result.warnings.length) toast.warning(result.warnings.join(' '));
      const blob = new Blob([result.text], {
        type: 'text/plain;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `newsletter-${draft.id}.${format === 'markdown' ? 'md' : 'txt'}`;
      document.body.append(a);
      try {
        a.click();
      } finally {
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    } catch {
      toast.error('Could not export this draft');
    }
  };
  return (
    <section aria-label="Newsletter drafting" className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold">Newsletter drafting</h2>
        <p className="text-sm text-muted-foreground">
          Evidence-backed synthesis for busy industry insiders.
        </p>
      </div>
      <details open={!state.profile}>
        <summary className="cursor-pointer font-medium">
          Newsletter settings
        </summary>
        <div className="mt-4">
          <NewsletterSettings
            key={workspaceId}
            profile={state.profile}
            audienceSuggestion={data.audienceSuggestion}
            pending={mutation.isPending}
            onSave={async (profile: NewsletterProfile) => {
              try {
                const result = await mutation.mutateAsync({
                  run: () =>
                    newsletterSaveProfile({ data: { workspaceId, profile } }),
                  success: 'Newsletter settings saved',
                });
                return result.type === 'saved';
              } catch {
                return false;
              }
            }}
          />
        </div>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={mutation.isPending || !state.profile}
          onClick={() =>
            run(
              () => newsletterPrepareThemes({ data: { workspaceId } }),
              'Theme preparation queued'
            )
          }
        >
          Prepare themes
        </Button>
        <Button
          variant="ghost"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh newsletter
        </Button>
      </div>
      {busyJobs.length ? (
        <div role="status" className="rounded-md border bg-muted p-3 text-sm">
          {busyJobs.map((j) => (
            <p key={j.id}>
              {j.kind === 'prepare'
                ? 'Preparing themes'
                : 'Drafting newsletter'}{' '}
              ·{' '}
              {j.status === 'queued' && j.runtime.mode === 'local'
                ? 'Queued for local execution'
                : j.status}{' '}
              · {j.stage} · {j.runtime.provider} · {j.runtime.model}
            </p>
          ))}
          <p>
            Work continues when you leave this page while its runtime stays
            active.
          </p>
        </div>
      ) : null}
      {failedJobs.length ? (
        <div>
          <h4 className="text-sm font-medium">
            Recent generation failures ({failedJobs.length})
          </h4>
          {failedJobs.slice(-5).map((j) => (
            <div className="mt-2 text-sm" key={j.id}>
              <p>
                {j.stage} · {j.runtime.provider} · {j.runtime.model}:{' '}
                {j.failure}
              </p>
              <Button
                variant="secondary"
                disabled={mutation.isPending}
                onClick={() =>
                  run(
                    () =>
                      newsletterRetry({ data: { workspaceId, jobId: j.id } }),
                    'New retry attempt queued'
                  )
                }
              >
                Retry failed work
              </Button>
              <JobDetails workspaceId={workspaceId} jobId={j.id} />
            </div>
          ))}
        </div>
      ) : null}
      {selection ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
          <span className="text-sm">
            Shared selection:{' '}
            {state.angles.find((a) => a.id === selection.angleId)?.title} ·{' '}
            {selection.status}
          </span>
          <Button
            variant="secondary"
            disabled={mutation.isPending}
            onClick={() =>
              run(
                () =>
                  newsletterAbandon({
                    data: { workspaceId, selectionId: selection.id },
                  }),
                'Selection abandoned'
              )
            }
          >
            Abandon selection
          </Button>
        </div>
      ) : state.profile ? (
        latest ? (
          state.skippedReports?.includes(reportId) ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm">Newsletter skipped for this report.</p>
              <Button
                variant="secondary"
                disabled={mutation.isPending}
                onClick={() =>
                  run(
                    () =>
                      newsletterSkip({
                        data: { workspaceId, reportId, skip: false },
                      }),
                    'Newsletter choice updated'
                  )
                }
              >
                Show themes
              </Button>
            </div>
          ) : (
            <>
              <Button
                variant="ghost"
                className="self-start"
                disabled={mutation.isPending}
                onClick={() =>
                  run(
                    () =>
                      newsletterSkip({
                        data: { workspaceId, reportId, skip: true },
                      }),
                    'Newsletter choice updated'
                  )
                }
              >
                Skip newsletter for this report
              </Button>
              <p className="text-sm">
                Choose one theme or leave these choices for later.
              </p>
              {state.offers.length < 3 ? (
                <p className="text-sm text-muted-foreground">
                  {state.offers.length} eligible themes are currently available.
                  Strong choices come first; weak choices need research.
                </p>
              ) : null}
              <div className="grid gap-3">
                {state.offers.map((theme) => (
                  <ThemeCard
                    key={theme.id}
                    theme={theme}
                    sources={state.sources}
                    pending={mutation.isPending}
                    onSelect={() =>
                      run(
                        () =>
                          newsletterSelect({
                            data: { workspaceId, reportId, angleId: theme.id },
                          }),
                        'Newsletter draft queued'
                      )
                    }
                  />
                ))}
              </div>
              {data.snoozed.length ? (
                <details>
                  <summary className="cursor-pointer text-sm">
                    Previously used angles — deliberate reuse
                  </summary>
                  <div className="mt-3 grid gap-3">
                    {data.snoozed.map((theme) => (
                      <ThemeCard
                        key={theme.id}
                        theme={theme}
                        sources={state.sources}
                        override
                        pending={mutation.isPending}
                        onSelect={(overrideReason) =>
                          run(
                            () =>
                              newsletterSelect({
                                data: {
                                  workspaceId,
                                  reportId,
                                  angleId: theme.id,
                                  overrideReason,
                                },
                              }),
                            'Newsletter draft queued'
                          )
                        }
                      />
                    ))}
                  </div>
                </details>
              ) : null}
            </>
          )
        ) : (
          <p className="text-sm text-muted-foreground">
            New newsletter selections are available from this Workspace’s latest
            report.
          </p>
        )
      ) : null}
      <DuplicateReview
        workspaceId={workspaceId}
        onChanged={() => void query.refetch()}
      />
      <NewsletterHistoryPanel
        workspaceId={workspaceId}
        onExport={(draft, format) => void exportVersion(draft, format)}
      />
      <TopicCorrections
        topics={state.topics}
        sources={state.sources}
        pending={mutation.isPending}
        onCorrect={(correction) =>
          run(
            () =>
              newsletterCorrectTopic({ data: { workspaceId, ...correction } }),
            'Topic correction saved'
          )
        }
      />
      <div className="flex flex-col gap-4">
        <h3 className="font-semibold">
          Saved draft versions ({state.drafts.length})
        </h3>
        {state.drafts.toReversed().map((draft) => (
          <SavedDraft
            key={draft.id}
            draft={draft}
            warnings={data.warnings[draft.id] ?? []}
            pending={mutation.isPending}
            canRegenerate={
              !busyJobs.some((job) => job.selectionId === draft.selectionId) &&
              state.selections.some(
                (s) => s.id === draft.selectionId && s.status === 'ready'
              )
            }
            onExport={(format) => void exportVersion(draft, format)}
            onRegenerate={(feedback) =>
              run(
                () =>
                  newsletterRegenerate({
                    data: {
                      workspaceId,
                      selectionId: draft.selectionId,
                      feedback,
                    },
                  }),
                'New draft version queued'
              )
            }
          />
        ))}
      </div>
    </section>
  );
}
