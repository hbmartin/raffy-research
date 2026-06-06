import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { toast } from 'sonner';

import type {
  SourceRecordId,
  WeeklyReportId,
  WorkspaceId,
} from '@/modules/kernel/domain/ids';

import { intelligenceQueries } from './wired-queries';
import type { FeedbackEventType } from '../domain/feedback';

export type ReportFeedbackContext = {
  workspaceId: WorkspaceId;
  reportId: WeeklyReportId;
};

export type RecordFeedbackArgs = {
  eventType: FeedbackEventType;
  targetType?: string;
  targetId?: string;
  sourceRecordId?: SourceRecordId;
  payload?: Record<string, unknown>;
};

/**
 * Records a CEO feedback event. Append-only; the only visible side effect is
 * `add_competitor_to_watchlist`, which refreshes the report after acceptance.
 */
export function useReportFeedback(context: ReportFeedbackContext) {
  const mutation = useMutation(intelligenceQueries.recordFeedback());
  const queryClient = useQueryClient();
  const router = useRouter();

  const record = (args: RecordFeedbackArgs) => {
    mutation.mutate(
      {
        workspaceId: context.workspaceId,
        reportId: context.reportId,
        eventType: args.eventType,
        targetType: args.targetType,
        targetId: args.targetId,
        sourceRecordId: args.sourceRecordId,
        payload: args.payload,
      },
      {
        onSuccess: (result) => {
          if (args.eventType === 'add_competitor_to_watchlist') {
            if (result?.competitorAccepted) {
              toast.success('Competitor added to your watchlist');
              void queryClient
                .invalidateQueries({
                  predicate: (query) => query.queryKey[0] === 'intelligence',
                })
                .then(() => router.invalidate());
            } else {
              toast.error('Could not add competitor to watchlist');
            }
          }
        },
        onError: () => {
          toast.error('Could not record feedback');
        },
      }
    );
  };

  const copyExcerpt = async (text: string, sourceRecordId?: SourceRecordId) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Excerpt copied');
      record({
        eventType: 'copy_excerpt',
        targetType: 'evidence',
        sourceRecordId,
      });
    } catch {
      toast.error('Could not copy excerpt');
    }
  };

  return { record, copyExcerpt, isPending: mutation.isPending };
}
