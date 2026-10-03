import { Result } from '@swan-io/boxed';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/platform/components/ui/button';

import { ArticlePreview } from './article-preview';
import { newsletterQueries } from './wired-queries';
import { type DraftVersion, zArticle } from '../domain/newsletter';

export function NewsletterHistoryPanel({
  workspaceId,
  onExport,
}: {
  workspaceId: string;
  onExport: (draft: DraftVersion, format: 'markdown' | 'text') => void;
}) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState('');
  const history = useInfiniteQuery({
    ...newsletterQueries.history(workspaceId),
    enabled: open,
  });
  const detail = useQuery({
    ...newsletterQueries.detail(workspaceId, selected),
    enabled: open && Boolean(selected),
  });
  const detailData = detail.data;
  const payload =
    detailData?.type === 'detail_found'
      ? Result.fromExecution(
          () => JSON.parse(detailData.payloadJson) as unknown
        )
      : undefined;
  const raw = payload?.isOk() ? payload.get() : undefined;
  const article = zArticle.safeParse(raw);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer font-medium">
        Newsletter history
      </summary>
      {history.isError ? (
        <p role="alert">
          History could not be loaded.{' '}
          <Button variant="ghost" onClick={() => void history.refetch()}>
            Refresh history
          </Button>
        </p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {history.data?.pages
          .flatMap((page) =>
            page.type === 'history_found' ? page.entries : []
          )
          .map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <span>
                {entry.createdAt.slice(0, 16).replace('T', ' ')} · {entry.kind}
              </span>
              <Button
                variant="ghost"
                onClick={() => setSelected(entry.id)}
                className="h-auto max-w-full text-left whitespace-normal"
              >
                {entry.summary}
              </Button>
            </li>
          ))}
      </ul>
      {history.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          Load twenty more
        </Button>
      ) : null}
      {detail.isFetching ? <p role="status">Loading history details…</p> : null}
      {detail.isError ? (
        <p role="alert">History details could not be loaded.</p>
      ) : null}
      {article.success ? (
        <article className="mt-3 rounded-md border p-3">
          <h3 className="font-semibold">{article.data.subject}</h3>
          {detailData?.type === 'detail_found'
            ? detailData.warnings.map((warning) => (
                <p
                  key={warning}
                  role="status"
                  className="text-amber-700 text-sm"
                >
                  {warning}
                </p>
              ))
            : null}
          <ArticlePreview markdown={article.data.markdown} />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => onExport(raw as DraftVersion, 'markdown')}
            >
              Export historical Markdown
            </Button>
            <Button
              variant="secondary"
              onClick={() => onExport(raw as DraftVersion, 'text')}
            >
              Export historical text
            </Button>
          </div>
          <details>
            <summary className="cursor-pointer text-sm">
              Saved guidance and audits
            </summary>
            <pre className="mt-2 max-h-96 overflow-auto text-xs break-words whitespace-pre-wrap">
              {JSON.stringify(raw, null, 2)}
            </pre>
          </details>
        </article>
      ) : raw ? (
        <pre className="mt-3 max-h-96 overflow-auto rounded-md border p-3 text-xs break-words whitespace-pre-wrap">
          {JSON.stringify(raw, null, 2)}
        </pre>
      ) : null}
    </details>
  );
}
