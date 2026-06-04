import { Link } from '@tanstack/react-router';
import {
  CheckIcon,
  ClipboardIcon,
  ExternalLinkIcon,
  PlusIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from 'lucide-react';
import { useState } from 'react';

import {
  AppPageLayout as AppLayout,
  AppPageLayoutContent as AppContent,
  AppPageLayoutTopBar as AppTopBar,
} from '@/platform/components/page-layout';
import {
  ManagerPageLayout as ManagerLayout,
  ManagerPageLayoutContent as ManagerContent,
  ManagerPageLayoutTopBar as ManagerTopBar,
  ManagerPageLayoutTopBarTitle as ManagerTopBarTitle,
} from '@/platform/components/page-layout';
import { Badge } from '@/platform/components/ui/badge';
import { Button } from '@/platform/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/platform/components/ui/card';

import type {
  ProviderCallbackEvent,
  SourceRecord,
  WeeklyReport,
  Workspace,
} from '@/modules/kernel/infrastructure/db/schema';

import type {
  ReportWithSources,
  WorkspaceConfiguration,
} from '../application/ports/intelligence-repository';
import {
  intelligenceAcceptSuggestedCompetitor,
  intelligenceRecordFeedback,
} from '../client';
import {
  type EvidenceItem,
  type ReportData,
  reportDataSchema,
} from '../domain/report-schema';

const sectionDefinitions = [
  ['what_looks_most_interesting', 'What looks most interesting'],
  ['contradictions', 'Contradictions'],
  ['topic_clusters', 'Topic clusters'],
  ['competitor_watch', 'Competitor watch'],
  ['suggested_competitors', 'Suggested competitors'],
  ['market_questions', 'Market questions'],
  ['possible_leads', 'Possible leads'],
  ['social_product_feedback', 'Social product feedback'],
  ['source_library', 'Source library'],
] as const;

type ReportSectionKey = (typeof sectionDefinitions)[number][0];

const dateLabel = (value: Date | string | null | undefined) => {
  if (!value) return 'Not available';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
};

const shortDateLabel = (value: Date | string | null | undefined) => {
  if (!value) return 'Not available';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
    new Date(value)
  );
};

const jsonPreview = (value: unknown) => JSON.stringify(value, null, 2);

function sourceTitle(source: SourceRecord | null | undefined) {
  return (
    source?.title ??
    source?.sourceName ??
    source?.externalUrl ??
    source?.sourceUrl ??
    'Untitled source'
  );
}

function sourceMapFromReport(report: ReportWithSources) {
  return new Map(
    report.sources.flatMap((sourceLink) =>
      sourceLink.sourceRecord
        ? [[sourceLink.sourceRecord.id, sourceLink.sourceRecord] as const]
        : []
    )
  );
}

function parseReport(report: WeeklyReport) {
  return reportDataSchema.safeParse(report.reportData);
}

function FeedbackActions(props: {
  reportId?: string;
  sourceRecordId?: string;
  targetId: string;
  targetType: string;
  workspaceId: string;
  excerpt?: string;
}) {
  const [state, setState] = useState<'idle' | 'done' | 'pending'>('idle');

  const record = async (
    eventType:
      | 'copy_excerpt'
      | 'less_like_this'
      | 'more_like_this'
      | 'not_useful'
      | 'useful'
  ) => {
    setState('pending');
    if (eventType === 'copy_excerpt' && props.excerpt) {
      await navigator.clipboard?.writeText(props.excerpt);
    }
    await intelligenceRecordFeedback({
      data: {
        eventType,
        payload: props.excerpt ? { excerpt: props.excerpt } : {},
        reportId: props.reportId,
        sourceRecordId: props.sourceRecordId,
        targetId: props.targetId,
        targetType: props.targetType,
        workspaceId: props.workspaceId,
      },
    });
    setState('done');
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="xs"
        variant="secondary"
        loading={state === 'pending'}
        onClick={() => record('useful')}
      >
        <ThumbsUpIcon />
        Useful
      </Button>
      <Button
        size="xs"
        variant="secondary"
        loading={state === 'pending'}
        onClick={() => record('not_useful')}
      >
        <ThumbsDownIcon />
        Not useful
      </Button>
      {!!props.excerpt && (
        <Button
          size="xs"
          variant="secondary"
          loading={state === 'pending'}
          onClick={() => record('copy_excerpt')}
        >
          <ClipboardIcon />
          Copy excerpt
        </Button>
      )}
      {state === 'done' && (
        <span className="inline-flex items-center gap-1 text-xs text-positive-700 dark:text-positive-200">
          <CheckIcon className="size-3" />
          Saved
        </span>
      )}
    </div>
  );
}

function EvidenceList(props: {
  evidence: EvidenceItem[];
  reportId: string;
  sourceMap: Map<string, SourceRecord>;
  workspaceId: string;
}) {
  if (!props.evidence.length) return null;

  return (
    <div className="mt-4 space-y-3">
      {props.evidence.map((evidence) => (
        <div
          key={evidence.id}
          className="rounded-sm border border-border/70 bg-muted/30 p-3"
        >
          <p className="text-sm leading-6">{evidence.excerpt}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {evidence.source_ids.map((sourceId) => {
              const source = props.sourceMap.get(sourceId);
              return (
                <Badge
                  key={sourceId}
                  variant="secondary"
                  render={
                    <Link to="/app/sources/$sourceId" params={{ sourceId }}>
                      {sourceTitle(source)}
                    </Link>
                  }
                />
              );
            })}
          </div>
          <div className="mt-3">
            <FeedbackActions
              excerpt={evidence.excerpt}
              reportId={props.reportId}
              targetId={evidence.id}
              targetType="evidence"
              workspaceId={props.workspaceId}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ReportItem(props: {
  item: ReportData[ReportSectionKey][number];
  reportData: ReportData;
  sectionKey: ReportSectionKey;
  sourceMap: Map<string, SourceRecord>;
}) {
  const evidence = [
    ...props.item.evidence,
    ...props.item.representative_evidence,
    ...props.item.all_evidence,
  ];
  const [pending, setPending] = useState(false);
  const isSuggestedCompetitor = props.sectionKey === 'suggested_competitors';

  const acceptCompetitor = async () => {
    setPending(true);
    await intelligenceAcceptSuggestedCompetitor({
      data: {
        competitorId: props.item.id,
        reportId: props.reportData.report_id,
        workspaceId: props.reportData.workspace_id,
      },
    });
    setPending(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base leading-6">
          {props.item.title}
        </CardTitle>
        {!!props.item.summary && (
          <CardDescription>{props.item.summary}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!!props.item.observation && (
          <p className="text-sm leading-6">{props.item.observation}</p>
        )}
        {!!props.item.why_this_may_matter && (
          <p className="text-sm leading-6 text-muted-foreground">
            {props.item.why_this_may_matter}
          </p>
        )}
        <EvidenceList
          evidence={evidence}
          reportId={props.reportData.report_id}
          sourceMap={props.sourceMap}
          workspaceId={props.reportData.workspace_id}
        />
        <div className="flex flex-wrap items-center gap-2">
          <FeedbackActions
            reportId={props.reportData.report_id}
            targetId={props.item.id}
            targetType="report_item"
            workspaceId={props.reportData.workspace_id}
          />
          {isSuggestedCompetitor && (
            <Button
              size="xs"
              variant="secondary"
              loading={pending}
              onClick={acceptCompetitor}
            >
              <PlusIcon />
              Add to watchlist
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ReportSection(props: {
  reportData: ReportData;
  sectionKey: ReportSectionKey;
  sourceMap: Map<string, SourceRecord>;
  title: string;
}) {
  const items = props.reportData[props.sectionKey];

  if (!items.length) {
    return (
      <details className="rounded-sm border border-dashed border-border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          {props.title} · 0
        </summary>
        <p className="mt-3 text-sm text-muted-foreground">
          No source-backed rows were captured for this section.
        </p>
      </details>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-normal">{props.title}</h2>
        <Badge variant="secondary">{items.length}</Badge>
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <ReportItem
            key={item.id}
            item={item}
            reportData={props.reportData}
            sectionKey={props.sectionKey}
            sourceMap={props.sourceMap}
          />
        ))}
      </div>
    </section>
  );
}

export function PageLatestReportEmpty() {
  return (
    <AppLayout>
      <AppTopBar />
      <AppContent>
        <div className="flex min-h-[60dvh] flex-col justify-center gap-3">
          <p className="text-sm font-medium text-muted-foreground">
            Weekly Market Intelligence
          </p>
          <h1 className="max-w-2xl text-3xl font-semibold tracking-normal">
            No weekly reports have been published yet.
          </h1>
          <p className="max-w-2xl text-base text-muted-foreground">
            Configure a workspace in the manager area, ingest sources, and the
            first frozen weekly report will appear here.
          </p>
        </div>
      </AppContent>
    </AppLayout>
  );
}

export function PageReport(props: { report: ReportWithSources }) {
  const parsed = parseReport(props.report.report);
  const sourceMap = sourceMapFromReport(props.report);

  if (!parsed.success) {
    return (
      <AppLayout>
        <AppTopBar />
        <AppContent>
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold tracking-normal">
              Report data failed validation
            </h1>
            <pre className="overflow-auto rounded-sm border bg-muted p-4 text-xs">
              {parsed.error.message}
            </pre>
          </div>
        </AppContent>
      </AppLayout>
    );
  }

  const reportData = parsed.data;

  return (
    <AppLayout>
      <AppTopBar />
      <AppContent>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <main className="space-y-8">
            <header className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {shortDateLabel(props.report.report.periodStart)} ·{' '}
                  {shortDateLabel(props.report.report.periodEnd)}
                </Badge>
                <Badge variant="positive">{props.report.report.status}</Badge>
              </div>
              <h1 className="max-w-4xl text-3xl font-semibold tracking-normal">
                {reportData.title}
              </h1>
              <div className="grid gap-3 md:grid-cols-3">
                {reportData.executive_summary.bullets.map((bullet, index) => (
                  <div
                    key={bullet}
                    className="rounded-sm border bg-card p-4 text-sm leading-6"
                  >
                    <span className="mb-2 block text-xs font-medium text-muted-foreground">
                      {index + 1}
                    </span>
                    {bullet}
                  </div>
                ))}
              </div>
            </header>
            {sectionDefinitions.map(([sectionKey, title]) => (
              <ReportSection
                key={sectionKey}
                reportData={reportData}
                sectionKey={sectionKey}
                sourceMap={sourceMap}
                title={title}
              />
            ))}
          </main>
          <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
            <h2 className="text-sm font-semibold tracking-normal">Sources</h2>
            <div className="space-y-2">
              {props.report.sources.map((sourceLink) => (
                <Link
                  key={sourceLink.id}
                  to="/app/sources/$sourceId"
                  params={{ sourceId: sourceLink.sourceRecordId }}
                  className="block rounded-sm border bg-card p-3 text-sm hover:bg-muted/50"
                >
                  <span className="block font-medium">
                    {sourceTitle(sourceLink.sourceRecord)}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {sourceLink.relationType}
                  </span>
                </Link>
              ))}
            </div>
          </aside>
        </div>
      </AppContent>
    </AppLayout>
  );
}

export function PageSource(props: { source: SourceRecord }) {
  return (
    <AppLayout>
      <AppTopBar />
      <AppContent>
        <article className="mx-auto max-w-4xl space-y-6">
          <header className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{props.source.providerName}</Badge>
              <Badge variant="secondary">{props.source.sourceType}</Badge>
              <Badge variant="secondary">
                {dateLabel(props.source.capturedAt)}
              </Badge>
            </div>
            <h1 className="text-3xl font-semibold tracking-normal">
              {sourceTitle(props.source)}
            </h1>
            {!!props.source.externalUrl && (
              <Button
                size="sm"
                variant="secondary"
                render={
                  <a href={props.source.externalUrl} target="_blank">
                    <ExternalLinkIcon />
                    Open external source
                  </a>
                }
              />
            )}
          </header>
          {!!props.source.contentText && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold tracking-normal">Excerpt</h2>
              <p className="rounded-sm border bg-card p-4 text-sm leading-6 whitespace-pre-wrap">
                {props.source.contentText}
              </p>
            </section>
          )}
          {(props.source.diffAddedText || props.source.diffRemovedText) && (
            <section className="grid gap-3 md:grid-cols-2">
              <div className="rounded-sm border border-positive-500/30 bg-positive-500/10 p-4">
                <h2 className="text-sm font-semibold tracking-normal">Added</h2>
                <p className="mt-2 text-sm leading-6 whitespace-pre-wrap">
                  {props.source.diffAddedText || 'No added text.'}
                </p>
              </div>
              <div className="rounded-sm border border-negative-500/30 bg-negative-500/10 p-4">
                <h2 className="text-sm font-semibold tracking-normal">
                  Removed
                </h2>
                <p className="mt-2 text-sm leading-6 whitespace-pre-wrap">
                  {props.source.diffRemovedText || 'No removed text.'}
                </p>
              </div>
            </section>
          )}
        </article>
      </AppContent>
    </AppLayout>
  );
}

export function PageWorkspaces(props: { workspaces: Workspace[] }) {
  return (
    <ManagerLayout>
      <ManagerTopBar>
        <ManagerTopBarTitle>Workspaces</ManagerTopBarTitle>
      </ManagerTopBar>
      <ManagerContent>
        <div className="space-y-3">
          {props.workspaces.map((workspace) => (
            <Link
              key={workspace.id}
              to="/manager/workspaces/$id"
              params={{ id: workspace.id }}
              className="block rounded-sm border bg-card p-4 hover:bg-muted/50"
            >
              <span className="block font-medium">{workspace.name}</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                {workspace.companyName} · {workspace.subcategory}
              </span>
            </Link>
          ))}
          {!props.workspaces.length && (
            <p className="rounded-sm border border-dashed p-4 text-sm text-muted-foreground">
              No intelligence workspaces have been configured.
            </p>
          )}
        </div>
      </ManagerContent>
    </ManagerLayout>
  );
}

export function PageWorkspaceDetail(props: {
  callbacks: ProviderCallbackEvent[];
  configuration: WorkspaceConfiguration;
}) {
  const { configuration } = props;

  return (
    <ManagerLayout>
      <ManagerTopBar>
        <ManagerTopBarTitle>{configuration.workspace.name}</ManagerTopBarTitle>
      </ManagerTopBar>
      <ManagerContent>
        <div className="space-y-6">
          <section className="grid gap-3 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Workspace</CardTitle>
                <CardDescription>
                  {configuration.workspace.companyName}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>{configuration.workspace.companyDescription}</p>
                <p className="text-muted-foreground">
                  {configuration.workspace.timezone}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Keywords</CardTitle>
                <CardDescription>Active watch terms</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {configuration.keywords.map((keyword) => (
                  <Badge
                    key={keyword.id}
                    variant={keyword.active ? 'default' : 'secondary'}
                  >
                    {keyword.keywordString}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-normal">Providers</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {configuration.providers.map((provider) => (
                <Card key={provider.id}>
                  <CardHeader>
                    <CardTitle>{provider.providerName}</CardTitle>
                    <CardDescription>
                      {provider.credentialsRef ?? 'No credential reference'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Badge
                      variant={provider.enabled ? 'positive' : 'secondary'}
                    >
                      {provider.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                    <pre className="max-h-40 overflow-auto rounded-sm bg-muted p-3 text-xs">
                      {jsonPreview(provider.config)}
                    </pre>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-normal">
              Competitors
            </h2>
            <div className="flex flex-wrap gap-2">
              {configuration.competitors.map((competitor) => (
                <Badge
                  key={competitor.id}
                  variant={
                    competitor.state === 'accepted' ? 'default' : 'secondary'
                  }
                >
                  {competitor.name} · {competitor.state}
                </Badge>
              ))}
            </div>
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-normal">
              Provider callback debug
            </h2>
            <div className="space-y-3">
              {props.callbacks.map((callback) => (
                <details
                  key={callback.id}
                  className="rounded-sm border bg-card p-4"
                >
                  <summary className="cursor-pointer text-sm font-medium">
                    {callback.providerName} · {callback.status} ·{' '}
                    {dateLabel(callback.receivedAt)}
                  </summary>
                  <pre className="mt-3 max-h-96 overflow-auto rounded-sm bg-muted p-3 text-xs">
                    {jsonPreview(callback.rawPayload)}
                  </pre>
                </details>
              ))}
              {!props.callbacks.length && (
                <p className="rounded-sm border border-dashed p-4 text-sm text-muted-foreground">
                  No provider callbacks have been received.
                </p>
              )}
            </div>
          </section>
        </div>
      </ManagerContent>
    </ManagerLayout>
  );
}
