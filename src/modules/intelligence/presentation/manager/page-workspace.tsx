import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import {
  PageLayout,
  PageLayoutContent,
  PageLayoutTopBar,
  PageLayoutTopBarTitle,
} from '@/platform/components/page-layout/manager';
import { Badge } from '@/platform/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/platform/components/ui/card';

import type { ProviderCallbackEvent } from '@/modules/intelligence/domain/ingestion';
import type { WorkspaceId } from '@/modules/kernel/domain/ids';

import { intelligenceQueries } from '../wired-queries';

const Section = (props: { title: string; children: React.ReactNode }) => (
  <Card>
    <CardHeader>
      <CardTitle className="text-base">{props.title}</CardTitle>
    </CardHeader>
    <CardContent>{props.children}</CardContent>
  </Card>
);

const stateBadgeVariant = (state: string) =>
  state === 'accepted'
    ? 'positive'
    : state === 'suggested'
      ? 'warning'
      : 'secondary';

export const PageWorkspace = (props: { workspaceId: WorkspaceId }) => {
  const { data: config } = useSuspenseQuery(
    intelligenceQueries.workspaceConfig(props.workspaceId)
  );
  const { data: reports } = useSuspenseQuery(
    intelligenceQueries.reportsByWorkspace(props.workspaceId)
  );
  const { data: callbacks } = useSuspenseQuery(
    intelligenceQueries.providerCallbacks(props.workspaceId)
  );

  if (!config) {
    return (
      <PageLayout>
        <PageLayoutContent>
          <p className="text-sm text-muted-foreground">Workspace not found.</p>
        </PageLayoutContent>
      </PageLayout>
    );
  }

  const { workspace } = config;

  return (
    <PageLayout>
      <PageLayoutTopBar>
        <PageLayoutTopBarTitle>{workspace.companyName}</PageLayoutTopBarTitle>
      </PageLayoutTopBar>
      <PageLayoutContent containerClassName="max-w-4xl">
        <div className="flex flex-col gap-4">
          <Section title="Company">
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Subcategory</dt>
                <dd>{workspace.subcategory}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Timezone</dt>
                <dd>{workspace.timezone}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Description</dt>
                <dd>{workspace.companyDescription}</dd>
              </div>
              {workspace.marketAssumptions ? (
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Market assumptions</dt>
                  <dd>{workspace.marketAssumptions}</dd>
                </div>
              ) : null}
            </dl>
          </Section>

          <Section title={`Keywords (${config.keywords.length})`}>
            <div className="flex flex-wrap gap-1.5">
              {config.keywords.map((keyword) => (
                <Badge key={keyword.id} variant="secondary" size="sm">
                  {keyword.keywordString}
                </Badge>
              ))}
            </div>
          </Section>

          <Section title={`Competitors (${config.competitors.length})`}>
            <ul className="flex flex-col gap-1 text-sm">
              {config.competitors.map((competitor) => (
                <li
                  key={competitor.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span>
                    {competitor.name}
                    {competitor.domain ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · {competitor.domain}
                      </span>
                    ) : null}
                  </span>
                  <Badge
                    variant={stateBadgeVariant(competitor.state)}
                    size="sm"
                  >
                    {competitor.state}
                  </Badge>
                </li>
              ))}
            </ul>
          </Section>

          <Section title={`Providers (${config.providerConfigs.length})`}>
            <ul className="flex flex-col gap-1 text-sm">
              {config.providerConfigs.map((provider) => (
                <li
                  key={provider.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span>
                    {provider.providerName}
                    {provider.credentialsRef ? (
                      <code className="ml-2 rounded bg-muted px-1 py-0.5 text-xs">
                        {provider.credentialsRef}
                      </code>
                    ) : null}
                  </span>
                  <Badge
                    variant={provider.enabled ? 'positive' : 'secondary'}
                    size="sm"
                  >
                    {provider.enabled ? 'enabled' : 'disabled'}
                  </Badge>
                </li>
              ))}
            </ul>
          </Section>

          {config.internalNoteConfigs.length > 0 ? (
            <Section
              title={`Internal notes (${config.internalNoteConfigs.length})`}
            >
              <ul className="flex flex-col gap-1 text-sm">
                {config.internalNoteConfigs.map((note) => (
                  <li key={note.id}>
                    <Badge variant="secondary" size="sm" className="mr-2">
                      {note.sourceSystem}
                    </Badge>
                    {note.sourceRef}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section title={`Reports (${reports.length})`}>
            {reports.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No reports generated yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {reports.map((report) => (
                  <li
                    key={report.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <Link
                      to="/app/reports/$reportId"
                      params={{ reportId: report.id }}
                      className="hover:underline"
                    >
                      {report.title ?? 'Untitled report'}
                    </Link>
                    <Badge
                      variant={
                        report.status === 'published'
                          ? 'positive'
                          : report.status === 'failed'
                            ? 'negative'
                            : 'secondary'
                      }
                      size="sm"
                    >
                      {report.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={`Provider callbacks (${callbacks.length})`}>
            {callbacks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No provider callbacks received yet.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {callbacks.map((callback: ProviderCallbackEvent) => (
                  <details
                    key={callback.id}
                    className="rounded-md border bg-muted/20 p-2 text-xs"
                  >
                    <summary className="cursor-pointer font-medium hover:underline">
                      {callback.providerName} · {callback.normalizationStatus} ·{' '}
                      {callback.receivedAt.toLocaleString()}
                    </summary>
                    <pre className="mt-2 max-h-60 overflow-auto rounded bg-muted p-2 text-[10px]">
                      {JSON.stringify(callback.rawPayload, null, 2)}
                    </pre>
                  </details>
                ))}
              </div>
            )}
          </Section>
        </div>
      </PageLayoutContent>
    </PageLayout>
  );
};
