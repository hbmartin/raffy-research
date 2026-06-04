import { ExternalLinkIcon } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/platform/components/ui/badge';
import { Button } from '@/platform/components/ui/button';

import type { SourceRecord } from '../domain/source';

const DiffBlock = (props: { added: string | null; removed: string | null }) => {
  if (!props.added && !props.removed) return null;
  return (
    <div className="flex flex-col gap-2">
      {props.removed ? (
        <div className="rounded-md bg-negative-100 p-2 text-sm text-negative-800 dark:bg-negative-500/20 dark:text-negative-100">
          <div className="mb-1 text-xs font-semibold uppercase opacity-70">
            Removed
          </div>
          <div className="whitespace-pre-wrap line-through">
            {props.removed}
          </div>
        </div>
      ) : null}
      {props.added ? (
        <div className="rounded-md bg-positive-100 p-2 text-sm text-positive-800 dark:bg-positive-500/20 dark:text-positive-100">
          <div className="mb-1 text-xs font-semibold uppercase opacity-70">
            Added
          </div>
          <div className="whitespace-pre-wrap">{props.added}</div>
        </div>
      ) : null}
    </div>
  );
};

export const SourceDetail = (props: {
  source: SourceRecord;
  allowRawPayload?: boolean;
}) => {
  const { source } = props;
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" size="sm">
          {source.sourceType}
        </Badge>
        <span className="text-xs text-muted-foreground">
          captured via {source.providerName}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {source.externalUrl ? (
          <Button
            variant="secondary"
            size="sm"
            render={
              <a href={source.externalUrl} target="_blank" rel="noreferrer">
                <ExternalLinkIcon />
                Open original source
              </a>
            }
          />
        ) : null}
        {source.contentText ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(source.contentText ?? '');
            }}
          >
            Copy excerpt
          </Button>
        ) : null}
      </div>

      <DiffBlock
        added={source.diffAddedText}
        removed={source.diffRemovedText}
      />

      {source.contentText ? (
        <p className="text-sm whitespace-pre-wrap text-foreground/90">
          {source.contentText}
        </p>
      ) : null}

      <div className="text-xs text-muted-foreground">
        Internal source reference:{' '}
        <code className="rounded bg-muted px-1 py-0.5">{source.id}</code>
      </div>

      {props.allowRawPayload ? (
        <div className="flex flex-col gap-2">
          <Button
            variant="ghost"
            size="xs"
            className="w-fit opacity-70"
            onClick={() => setShowRaw((value) => !value)}
          >
            {showRaw ? 'Hide' : 'Show'} raw provider payload
          </Button>
          {showRaw ? (
            <pre className="overflow-x-auto rounded-md bg-muted p-2 text-2xs">
              {JSON.stringify(source.rawPayload, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
