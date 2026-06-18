import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  PageLayout,
  PageLayoutContent,
  PageLayoutTopBar,
  PageLayoutTopBarTitle,
} from '@/platform/components/page-layout/manager';
import { Badge } from '@/platform/components/ui/badge';
import { Button } from '@/platform/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/platform/components/ui/card';

import type { ProviderCallbackEvent } from '@/modules/intelligence/domain/ingestion';
import {
  LOCAL_AI_PROVIDERS,
  type LocalAiProviderName,
} from '@/modules/intelligence/domain/local-ai';
import type { SourceRecord } from '@/modules/intelligence/domain/source';
import type { WorkspaceId } from '@/modules/kernel/domain/ids';
import { envClient } from '@/platform/env/client';

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

type LocalAiEvent = {
  type: string;
  message?: string;
  action?: string;
  label?: string;
  artifact?: {
    kind?: string;
    sources?: SourceRecord[];
    periodStart?: string;
    periodEnd?: string;
    [key: string]: unknown;
  };
  data?: Record<string, unknown>;
};

const toDateInputValue = (date: Date) => date.toISOString().slice(0, 10);

const PROVIDER_LABELS: Record<LocalAiProviderName, string> = {
  'codex-cli': 'Codex CLI',
  'claude-code': 'Claude Code',
  ollama: 'Ollama',
};

const DevAiConsole = (props: {
  workspaceId: WorkspaceId;
  callbacks: ProviderCallbackEvent[];
}) => {
  const [periodDate, setPeriodDate] = useState(() =>
    toDateInputValue(new Date())
  );
  const [provider, setProvider] = useState<LocalAiProviderName>('codex-cli');
  const [model, setModel] = useState('');
  const [includeSourceSummaries, setIncludeSourceSummaries] = useState(true);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [periodLabel, setPeriodLabel] = useState('');
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    () => new Set()
  );
  const [selectedCallbacks, setSelectedCallbacks] = useState<Set<string>>(
    () => new Set()
  );
  const [events, setEvents] = useState<string[]>([]);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const selectedSourceIds = useMemo(
    () => [...selectedSources],
    [selectedSources]
  );
  const selectedCallbackIds = useMemo(
    () => [...selectedCallbacks],
    [selectedCallbacks]
  );

  const appendEvent = useCallback((line: string) => {
    setEvents((current) => [line, ...current].slice(0, 80));
  }, []);

  const runAction = useCallback(
    async (action: string) => {
      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      setRunningAction(action);
      appendEvent(`${action}: started`);

      try {
        const response = await fetch('/api/dev/intelligence/local-ai/stream', {
          method: 'POST',
          signal: abortController.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action,
            workspaceId: props.workspaceId,
            periodDate,
            provider,
            ...(model.trim() ? { model: model.trim() } : {}),
            sourceRecordIds: selectedSourceIds,
            callbackEventIds: selectedCallbackIds,
            includeSourceSummaries,
          }),
        });

        if (!response.ok || !response.body) {
          appendEvent(`${action}: HTTP ${response.status}`);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;
            let event: LocalAiEvent;
            try {
              event = JSON.parse(line) as LocalAiEvent;
            } catch (error) {
              appendEvent(
                `${action}: malformed JSON line (${error instanceof Error ? error.message : 'parse failed'}): ${line.slice(0, 120)}`
              );
              continue;
            }

            if (
              event.type === 'artifact' &&
              event.artifact?.kind === 'period_sources'
            ) {
              const nextSources = event.artifact.sources ?? [];
              setSources(nextSources);
              setPeriodLabel(
                event.artifact.periodStart && event.artifact.periodEnd
                  ? `${new Date(event.artifact.periodStart).toLocaleDateString()} - ${new Date(event.artifact.periodEnd).toLocaleDateString()}`
                  : ''
              );
              setSelectedSources(
                new Set(nextSources.map((source) => source.id))
              );
            }

            if (event.type === 'error') {
              appendEvent(`${action}: ${event.message ?? 'error'}`);
              continue;
            }

            if (event.type === 'tool_event') {
              appendEvent(`${action}: tool ${event.label ?? 'event'}`);
              continue;
            }

            if (event.type === 'artifact') {
              appendEvent(`${action}: ${event.artifact?.kind ?? 'artifact'}`);
              continue;
            }

            if (event.type === 'start') {
              appendEvent(
                `${action}: ${event.message ?? event.label ?? 'started'}`
              );
              continue;
            }

            if (event.type === 'step') {
              appendEvent(`${action}: ${event.message ?? event.label}`);
              continue;
            }

            if (event.type === 'done') {
              appendEvent(`${action}: done`);
            }
          }
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          appendEvent(`${action}: cancelled`);
          return;
        }
        appendEvent(
          `${action}: ${error instanceof Error ? error.message : 'failed'}`
        );
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
          setRunningAction(null);
        }
      }
    },
    [
      appendEvent,
      includeSourceSummaries,
      model,
      periodDate,
      props.workspaceId,
      provider,
      selectedCallbackIds,
      selectedSourceIds,
    ]
  );

  const stopRunningAction = useCallback(() => {
    if (!abortControllerRef.current) return;
    appendEvent(`${runningAction ?? 'local_ai'}: cancelling`);
    abortControllerRef.current.abort();
  }, [appendEvent, runningAction]);

  useEffect(() => {
    const timeoutId = globalThis.setTimeout(() => {
      void runAction('list_sources');
    }, 0);
    return () => globalThis.clearTimeout(timeoutId);
    // Only reload period sources when the selected week or workspace changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodDate, props.workspaceId]);

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
    },
    []
  );

  const toggleSource = (id: string) => {
    setSelectedSources((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCallback = (id: string) => {
    setSelectedCallbacks((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isRunning = runningAction !== null;

  return (
    <Section title="Local AI console">
      <div
        className="flex flex-col gap-4 text-sm"
        data-testid="local-ai-console"
      >
        <div className="grid gap-3 md:grid-cols-4">
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Week date
            </span>
            <input
              type="date"
              value={periodDate}
              onChange={(event) => setPeriodDate(event.target.value)}
              className="h-9 rounded-md border bg-background px-3"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Provider
            </span>
            <select
              value={provider}
              onChange={(event) => {
                const value = event.target.value;
                if (LOCAL_AI_PROVIDERS.includes(value as LocalAiProviderName)) {
                  setProvider(value as LocalAiProviderName);
                }
              }}
              className="h-9 rounded-md border bg-background px-3"
            >
              {LOCAL_AI_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 md:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">
              Model
            </span>
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="env default"
              className="h-9 rounded-md border bg-background px-3"
            />
          </label>
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeSourceSummaries}
            onChange={(event) =>
              setIncludeSourceSummaries(event.target.checked)
            }
          />
          <span>Feed latest source summaries into report prompt</span>
        </label>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={isRunning}
            onClick={() => void runAction('list_sources')}
          >
            Load sources
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={isRunning}
            onClick={() => void runAction('ingest_enabled')}
          >
            Ingest enabled
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={isRunning || selectedCallbackIds.length === 0}
            onClick={() => void runAction('reprocess_callbacks')}
          >
            Reprocess callbacks
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={isRunning || selectedSourceIds.length === 0}
            onClick={() => void runAction('summarize_sources')}
          >
            Summarize sources
          </Button>
          <Button
            type="button"
            disabled={isRunning || selectedSourceIds.length === 0}
            onClick={() => void runAction('generate_report')}
          >
            Generate report
          </Button>
          <Button
            type="button"
            disabled={isRunning}
            onClick={() => void runAction('full_workflow')}
          >
            Full workflow
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={isRunning}
            onClick={() => void runAction('evaluate_report')}
          >
            Evaluate report
          </Button>
          {isRunning ? (
            <Button
              type="button"
              variant="destructive"
              onClick={stopRunningAction}
            >
              Stop
            </Button>
          ) : null}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">
                Sources ({selectedSourceIds.length}/{sources.length})
              </h3>
              {periodLabel ? (
                <span className="text-xs text-muted-foreground">
                  {periodLabel}
                </span>
              ) : null}
            </div>
            <div className="max-h-72 overflow-auto rounded-md border">
              {sources.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  No sources loaded for this week.
                </p>
              ) : (
                sources.map((source) => (
                  <label
                    key={source.id}
                    className="flex gap-2 border-b p-2 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSources.has(source.id)}
                      onChange={() => toggleSource(source.id)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {source.title ?? source.sourceName ?? source.id}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {source.providerName} · {source.sourceType}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">
              Callbacks ({selectedCallbackIds.length}/{props.callbacks.length})
            </h3>
            <div className="max-h-72 overflow-auto rounded-md border">
              {props.callbacks.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  No callbacks available.
                </p>
              ) : (
                props.callbacks.map((callback) => (
                  <label
                    key={callback.id}
                    className="flex gap-2 border-b p-2 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={selectedCallbacks.has(callback.id)}
                      onChange={() => toggleCallback(callback.id)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {callback.providerName} · {callback.normalizationStatus}
                      </span>
                      <span
                        className="block truncate text-xs text-muted-foreground"
                        suppressHydrationWarning
                      >
                        {callback.receivedAt.toLocaleString()}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="rounded-md border bg-muted/20 p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Run log</h3>
            {runningAction ? (
              <Badge variant="secondary" size="sm">
                {runningAction}
              </Badge>
            ) : null}
          </div>
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground">No runs yet.</p>
          ) : (
            <ol className="max-h-52 overflow-auto text-xs">
              {events.map((event, index) => (
                <li key={`${event}-${index}`} className="py-0.5">
                  {event}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Section>
  );
};

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
          {envClient.DEV ? (
            <DevAiConsole
              workspaceId={props.workspaceId}
              callbacks={callbacks}
            />
          ) : null}

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
                    <summary
                      className="cursor-pointer font-medium hover:underline"
                      suppressHydrationWarning
                    >
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
