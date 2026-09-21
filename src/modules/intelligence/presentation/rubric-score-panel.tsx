import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/platform/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/platform/components/ui/card';

import type { WeeklyReportId, WorkspaceId } from '@/modules/kernel/domain/ids';

import { intelligenceQueries } from './wired-queries';
import type { ReportRubricScore, RubricDimension } from '../domain/rubric';
import {
  RUBRIC_DIMENSIONS,
  RUBRIC_NOTE_MAX_LENGTH,
  RUBRIC_SCORE_MAX,
  RUBRIC_SCORE_MIN,
} from '../domain/rubric';

const DIMENSION_LABELS: Record<RubricDimension, string> = {
  relevance: 'Relevance',
  accuracy: 'Accuracy',
  novelty: 'Novelty',
};

const DIMENSION_HINTS: Record<RubricDimension, string> = {
  relevance: 'Does this report cover what matters to us this week?',
  accuracy: 'Are the claims faithful to the underlying sources?',
  novelty: 'Did it tell us something we did not already know?',
};

const SCORE_VALUES = Array.from(
  { length: RUBRIC_SCORE_MAX - RUBRIC_SCORE_MIN + 1 },
  (_, index) => RUBRIC_SCORE_MIN + index
);

type DraftScores = Partial<Record<RubricDimension, number>>;
type DraftState = {
  key: string;
  draft: DraftScores;
  note: string;
};

const createDraftState = (
  key: string,
  existing: ReportRubricScore | null
): DraftState => ({
  key,
  draft: existing
    ? {
        relevance: existing.relevance,
        accuracy: existing.accuracy,
        novelty: existing.novelty,
      }
    : {},
  note: existing?.note ?? '',
});

const DimensionRow = (props: {
  dimension: RubricDimension;
  value: number | undefined;
  onChange: (value: number) => void;
}) => (
  <div className="flex flex-wrap items-center justify-between gap-2">
    <div>
      <div className="text-sm font-medium">
        {DIMENSION_LABELS[props.dimension]}
      </div>
      <div className="text-xs text-muted-foreground">
        {DIMENSION_HINTS[props.dimension]}
      </div>
    </div>
    <div
      className="flex items-center gap-1"
      role="radiogroup"
      aria-label={DIMENSION_LABELS[props.dimension]}
    >
      {SCORE_VALUES.map((score) => (
        <Button
          key={score}
          type="button"
          variant={props.value === score ? 'default' : 'secondary'}
          size="icon-sm"
          role="radio"
          aria-checked={props.value === score}
          onClick={() => props.onChange(score)}
        >
          {score}
        </Button>
      ))}
    </div>
  </div>
);

export const RubricScorePanel = (props: {
  workspaceId: WorkspaceId;
  reportId: WeeklyReportId;
}) => {
  const queryClient = useQueryClient();
  const scoreQuery = useQuery(
    intelligenceQueries.reportScore(props.workspaceId, props.reportId)
  );
  const mutation = useMutation(intelligenceQueries.scoreReport());

  const existing =
    scoreQuery.data?.workspaceId === props.workspaceId &&
    scoreQuery.data.reportId === props.reportId
      ? scoreQuery.data
      : null;
  const scoreStateKey = existing
    ? `${props.workspaceId}:${props.reportId}:${existing.id}:${String(existing.updatedAt)}`
    : `${props.workspaceId}:${props.reportId}:empty`;
  const [draftState, setDraftState] = useState<DraftState>(() =>
    createDraftState(scoreStateKey, existing)
  );
  const currentDraftState =
    draftState.key === scoreStateKey
      ? draftState
      : createDraftState(scoreStateKey, existing);
  const { draft, note } = currentDraftState;

  const isComplete = RUBRIC_DIMENSIONS.every(
    (dimension) => draft[dimension] !== undefined
  );

  const submit = () => {
    const { relevance, accuracy, novelty } = draft;
    if (
      relevance === undefined ||
      accuracy === undefined ||
      novelty === undefined
    ) {
      return;
    }
    mutation.mutate(
      {
        workspaceId: props.workspaceId,
        reportId: props.reportId,
        relevance,
        accuracy,
        novelty,
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast.success('Report score saved');
          void queryClient.invalidateQueries({
            queryKey: intelligenceQueries.reportScore(
              props.workspaceId,
              props.reportId
            ).queryKey,
          });
        },
        onError: () => {
          toast.error('Could not save the report score');
        },
      }
    );
  };

  return (
    <Card data-testid="rubric-score-panel">
      <CardHeader>
        <CardTitle className="text-base">Score this report</CardTitle>
        <CardDescription>
          {existing
            ? 'You scored this report. Adjust and save to replace your score.'
            : 'Rate this report so we can track whether reports are getting better.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {RUBRIC_DIMENSIONS.map((dimension) => (
          <DimensionRow
            key={dimension}
            dimension={dimension}
            value={draft[dimension]}
            onChange={(value) =>
              setDraftState((current) => {
                const base =
                  current.key === scoreStateKey
                    ? current
                    : createDraftState(scoreStateKey, existing);
                return {
                  ...base,
                  draft: { ...base.draft, [dimension]: value },
                };
              })
            }
          />
        ))}
        <label className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Note (optional)
          </span>
          <textarea
            value={note}
            onChange={(event) => {
              const nextNote = event.target.value;
              setDraftState((current) => {
                const base =
                  current.key === scoreStateKey
                    ? current
                    : createDraftState(scoreStateKey, existing);
                return { ...base, note: nextNote };
              });
            }}
            rows={2}
            maxLength={RUBRIC_NOTE_MAX_LENGTH}
            placeholder="What was missing, wrong, or especially useful?"
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
        </label>
        <Button
          type="button"
          className="w-fit"
          disabled={!isComplete || mutation.isPending}
          onClick={submit}
        >
          {existing ? 'Update score' : 'Save score'}
        </Button>
      </CardContent>
    </Card>
  );
};
