import {
  CopyIcon,
  ExternalLinkIcon,
  FlagIcon,
  StarIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from 'lucide-react';

import { Button } from '@/platform/components/ui/button';

import { toSourceRecordId } from '@/modules/kernel/domain/ids';

import type { RecordFeedbackArgs } from './use-report-feedback';
import type { EvidenceItem } from '../domain/report-data';

export type EvidenceActions = {
  record: (args: RecordFeedbackArgs) => void;
  copyExcerpt: (
    text: string,
    sourceRecordId?: ReturnType<typeof toSourceRecordId>
  ) => void;
  onOpenSource: (sourceId: string) => void;
};

const FeedbackButtons = (props: {
  actions: EvidenceActions;
  targetType: string;
  targetId: string;
  sourceId?: string;
  allowFlag?: boolean;
}) => {
  const sourceRecordId = props.sourceId
    ? toSourceRecordId(props.sourceId)
    : undefined;
  const base = {
    targetType: props.targetType,
    targetId: props.targetId,
    sourceRecordId,
  };
  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Useful"
        title="Useful"
        onClick={() => props.actions.record({ ...base, eventType: 'useful' })}
      >
        <ThumbsUpIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Not useful"
        title="Not useful"
        onClick={() =>
          props.actions.record({ ...base, eventType: 'not_useful' })
        }
      >
        <ThumbsDownIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="More like this"
        title="More like this"
        onClick={() =>
          props.actions.record({ ...base, eventType: 'more_like_this' })
        }
      >
        <StarIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Less like this"
        title="Less like this"
        onClick={() =>
          props.actions.record({ ...base, eventType: 'less_like_this' })
        }
      >
        <ThumbsDownIcon className="opacity-50" />
      </Button>
      {props.allowFlag ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Flag bad synthesis"
          title="Flag bad synthesis"
          onClick={() =>
            props.actions.record({ ...base, eventType: 'flag_bad_synthesis' })
          }
        >
          <FlagIcon />
        </Button>
      ) : null}
    </div>
  );
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
            onClick={() =>
              actions.copyExcerpt(
                evidence.excerpt,
                primarySourceId ? toSourceRecordId(primarySourceId) : undefined
              )
            }
          >
            <CopyIcon />
          </Button>
          <FeedbackButtons
            actions={actions}
            targetType="evidence"
            targetId={evidence.id}
            sourceId={primarySourceId}
            allowFlag
          />
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

export { FeedbackButtons };
