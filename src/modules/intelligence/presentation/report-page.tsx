import { ChevronDownIcon, PlusIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { Badge } from '@/platform/components/ui/badge';
import { Button } from '@/platform/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/platform/components/ui/card';
import { Separator } from '@/platform/components/ui/separator';

import { type EvidenceActions, EvidenceList } from './report-evidence';
import { SourcePanel } from './source-panel';
import { useReportFeedback } from './use-report-feedback';
import type { WeeklyReport } from '../domain/report';
import type {
  NewnessLabelValue,
  SuggestedCompetitor,
  TopicCluster,
  TrendLabelValue,
} from '../domain/report-data';

const SectionShell = (props: {
  title: string;
  description?: string;
  isEmpty: boolean;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-3">
    <div>
      <h2 className="text-lg font-semibold">{props.title}</h2>
      {props.description ? (
        <p className="text-sm text-muted-foreground">{props.description}</p>
      ) : null}
    </div>
    {props.isEmpty ? (
      <p className="text-sm text-muted-foreground italic">
        No new evidence this week.
      </p>
    ) : (
      props.children
    )}
  </section>
);

const trendBadge = (trend: TrendLabelValue) => {
  switch (trend) {
    case 'rising':
      return (
        <Badge variant="positive" size="sm">
          Rising
        </Badge>
      );
    case 'declining':
      return (
        <Badge variant="warning" size="sm">
          Declining
        </Badge>
      );
    case 'stable':
      return (
        <Badge variant="secondary" size="sm">
          Stable
        </Badge>
      );
    default:
      return null;
  }
};

const newnessBadge = (newness: NewnessLabelValue) =>
  newness === 'new_this_week' ? (
    <Badge variant="positive" size="sm">
      New this week
    </Badge>
  ) : null;

const TopicClusterCard = (props: {
  cluster: TopicCluster;
  actions: EvidenceActions;
}) => {
  const { cluster, actions } = props;
  const [expanded, setExpanded] = useState(false);
  const hasMore =
    cluster.all_evidence.length > cluster.representative_evidence.length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{cluster.title}</CardTitle>
          {newnessBadge(cluster.labels.newness)}
          {trendBadge(cluster.labels.trend)}
        </div>
        <CardDescription>{cluster.summary}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm">{cluster.observation}</p>
        {cluster.why_this_may_matter ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              Why this may matter:{' '}
            </span>
            {cluster.why_this_may_matter}
          </p>
        ) : null}
        <EvidenceList
          items={
            expanded ? cluster.all_evidence : cluster.representative_evidence
          }
          actions={actions}
        />
        {hasMore ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronDownIcon
              className={expanded ? 'rotate-180 transition' : 'transition'}
            />
            {expanded
              ? 'Show less'
              : `Show all ${cluster.all_evidence.length} evidence items`}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
};

const SuggestedCompetitorCard = (props: {
  competitor: SuggestedCompetitor;
  actions: EvidenceActions;
  onAdd: (competitorId: string) => void;
}) => {
  const { competitor } = props;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            {competitor.name}
            {competitor.domain ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {competitor.domain}
              </span>
            ) : null}
          </CardTitle>
          {competitor.competitor_id ? (
            <Button
              size="sm"
              onClick={() => props.onAdd(competitor.competitor_id ?? '')}
            >
              <PlusIcon />
              Add to watchlist
            </Button>
          ) : null}
        </div>
        <CardDescription>{competitor.why_suggested}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {competitor.similarity ? (
          <p className="text-sm text-muted-foreground">
            {competitor.similarity}
          </p>
        ) : null}
        <EvidenceList items={competitor.evidence} actions={props.actions} />
      </CardContent>
    </Card>
  );
};

export type ReportPageBodyProps = {
  report: WeeklyReport;
  allowRawPayload?: boolean;
};

export const ReportPageBody = (props: ReportPageBodyProps) => {
  const { report } = props;
  const feedback = useReportFeedback({
    workspaceId: report.workspaceId,
    reportId: report.id,
  });
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  const actions: EvidenceActions = {
    record: feedback.record,
    copyExcerpt: (text, sourceRecordId) =>
      void feedback.copyExcerpt(text, sourceRecordId),
    onOpenSource: (id) => setSelectedSourceId(id),
  };

  const data = report.reportData;

  if (!data) {
    return (
      <div className="rounded-md border border-warning-200 bg-warning-100 p-4 text-sm text-warning-800 dark:bg-warning-500/20 dark:text-warning-100">
        This report has no published content
        {report.failureReason ? `: ${report.failureReason}` : '.'}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Executive Summary</h2>
        <ul className="flex flex-col gap-2">
          {data.executive_summary.bullets.map((bullet, index) => (
            <li
              key={index}
              className="flex gap-2 rounded-md border bg-card p-3 text-sm"
            >
              <span className="font-semibold text-primary">{index + 1}.</span>
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      </section>

      <SectionShell
        title="What Looks Most Interesting"
        isEmpty={data.what_looks_most_interesting.length === 0}
      >
        <div className="flex flex-col gap-3">
          {data.what_looks_most_interesting.map((item) => (
            <Card key={item.id}>
              <CardHeader>
                <CardTitle className="text-base">{item.title}</CardTitle>
                <CardDescription>{item.summary}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {item.why_this_may_matter ? (
                  <p className="text-sm text-muted-foreground">
                    {item.why_this_may_matter}
                  </p>
                ) : null}
                <EvidenceList items={item.evidence} actions={actions} />
              </CardContent>
            </Card>
          ))}
        </div>
      </SectionShell>

      <SectionShell
        title="Contradictions / Assumptions to Revisit"
        isEmpty={data.contradictions.length === 0}
      >
        <div className="flex flex-col gap-3">
          {data.contradictions.map((item) => (
            <Card key={item.id}>
              <CardHeader>
                <CardTitle className="text-base">{item.title}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {item.internal_assumption ? (
                  <p>
                    <span className="font-medium">Internal assumption: </span>
                    {item.internal_assumption}
                  </p>
                ) : null}
                {item.external_signal ? (
                  <p>
                    <span className="font-medium">External signal: </span>
                    {item.external_signal}
                  </p>
                ) : null}
                <p className="text-muted-foreground">{item.observation}</p>
                <EvidenceList items={item.evidence} actions={actions} />
              </CardContent>
            </Card>
          ))}
        </div>
      </SectionShell>

      <SectionShell
        title="Topic Clusters"
        isEmpty={data.topic_clusters.length === 0}
      >
        <div className="flex flex-col gap-3">
          {data.topic_clusters.map((cluster) => (
            <TopicClusterCard
              key={cluster.id}
              cluster={cluster}
              actions={actions}
            />
          ))}
        </div>
      </SectionShell>

      <SectionShell
        title="Competitor Watch"
        isEmpty={
          data.competitor_watch.length === 0 &&
          data.suggested_competitors.length === 0
        }
      >
        <div className="flex flex-col gap-3">
          {data.competitor_watch.map((item) => (
            <Card key={item.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  {item.competitor_name}
                  {item.change_type ? (
                    <Badge variant="secondary" size="sm" className="ml-2">
                      {item.change_type.replaceAll('_', ' ')}
                    </Badge>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm">{item.observation}</p>
                <EvidenceList items={item.evidence} actions={actions} />
              </CardContent>
            </Card>
          ))}
          {data.suggested_competitors.length > 0 ? (
            <>
              <Separator />
              <h3 className="text-sm font-semibold text-muted-foreground">
                Suggested competitors
              </h3>
              {data.suggested_competitors.map((competitor) => (
                <SuggestedCompetitorCard
                  key={competitor.id}
                  competitor={competitor}
                  actions={actions}
                  onAdd={(competitorId) =>
                    feedback.record({
                      eventType: 'add_competitor_to_watchlist',
                      targetType: 'competitor',
                      targetId: competitorId,
                    })
                  }
                />
              ))}
            </>
          ) : null}
        </div>
      </SectionShell>

      <SectionShell
        title="Market Questions"
        isEmpty={data.market_questions.length === 0}
      >
        <ul className="flex flex-col gap-3">
          {data.market_questions.map((item) => (
            <li key={item.id} className="rounded-md border bg-card p-3">
              <p className="text-sm font-medium">{item.question}</p>
              <div className="mt-2">
                <EvidenceList items={item.evidence} actions={actions} />
              </div>
            </li>
          ))}
        </ul>
      </SectionShell>

      <SectionShell
        title="Possible Leads"
        isEmpty={data.possible_leads.length === 0}
      >
        <div className="flex flex-col gap-3">
          {data.possible_leads.map((item) => (
            <Card key={item.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  {item.person_or_company ?? 'Possible lead'}
                </CardTitle>
                <CardDescription>“{item.source_excerpt}”</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <p className="text-muted-foreground">{item.why_relevant}</p>
                {item.matched_keyword ? (
                  <Badge variant="secondary" size="sm" className="w-fit">
                    {item.matched_keyword}
                  </Badge>
                ) : null}
                <EvidenceList items={item.evidence} actions={actions} />
              </CardContent>
            </Card>
          ))}
        </div>
      </SectionShell>

      <SectionShell
        title="Social / Product Feedback"
        isEmpty={data.social_product_feedback.length === 0}
      >
        <div className="flex flex-col gap-3">
          {data.social_product_feedback.map((item) => (
            <Card key={item.id}>
              <CardHeader>
                <Badge variant="secondary" size="sm" className="w-fit">
                  {item.label.replaceAll('_', ' ')}
                </Badge>
                <CardDescription>{item.summary}</CardDescription>
              </CardHeader>
              <CardContent>
                <EvidenceList items={item.evidence} actions={actions} />
              </CardContent>
            </Card>
          ))}
        </div>
      </SectionShell>

      <SectionShell
        title="Source Library"
        isEmpty={data.source_library.length === 0}
      >
        <ul className="flex flex-col gap-2">
          {data.source_library.map((item) => (
            <li
              key={item.source_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card p-3"
            >
              <div className="text-sm">
                {item.source_title ?? 'Source'}
                {item.provider_name ? (
                  <span className="text-xs text-muted-foreground">
                    {' '}
                    · captured via {item.provider_name}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                <Badge
                  variant={
                    item.relation_type === 'cited' ? 'positive' : 'secondary'
                  }
                  size="sm"
                >
                  {item.relation_type === 'cited' ? 'Cited' : 'Relevant'}
                </Badge>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setSelectedSourceId(item.source_id)}
                >
                  Inspect
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </SectionShell>

      <SourcePanel
        sourceId={selectedSourceId}
        open={selectedSourceId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedSourceId(null);
        }}
        allowRawPayload={props.allowRawPayload}
      />
    </div>
  );
};
