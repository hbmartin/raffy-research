import { CopyIcon, ExternalLinkIcon } from 'lucide-react';

import { Button } from '@/platform/components/ui/button';

import type { EvidenceItem } from '../domain/report-data';

export type EvidenceActions = {
  copyExcerpt: (text: string) => void;
  onOpenSource: (sourceId: string) => void;
};

const EvidenceRow = (props: {
  evidence: EvidenceItem;
  actions: EvidenceActions;
}) => {
  const { evidence, actions } = props;
  const primarySourceId = evidence.source_ids[0];

  return (
    <li className="rounded-md border bg-card p-3">
      <p className="text-sm text-foreground/90">“{evidence.excerpt}”</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {evidence.source_title ?? 'Source'}
          {evidence.provider_name ? (
            <span className="opacity-70">
              {' '}
              · captured via {evidence.provider_name}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-0.5">
          {primarySourceId ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Open source"
              title="Open source"
              onClick={() => actions.onOpenSource(primarySourceId)}
            >
              <ExternalLinkIcon />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Copy excerpt"
            title="Copy excerpt"
            onClick={() => actions.copyExcerpt(evidence.excerpt)}
          >
            <CopyIcon />
          </Button>
        </div>
      </div>
    </li>
  );
};

export const EvidenceList = (props: {
  items: EvidenceItem[];
  actions: EvidenceActions;
}) => {
  if (props.items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {props.items.map((evidence) => (
        <EvidenceRow
          key={evidence.id}
          evidence={evidence}
          actions={props.actions}
        />
      ))}
    </ul>
  );
};
