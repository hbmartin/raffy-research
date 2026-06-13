import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
import type { RubricDimension } from '../domain/rubric';
import {
  RUBRIC_DIMENSIONS,
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
  const scoreQuery = useQuery(intelligenceQueries.reportScore(props.reportId));
  const mutation = useMutation(intelligenceQueries.scoreReport());

  const [draft, setDraft] = useState<DraftScores>({});
  const [note, setNote] = useState('');

  const existing = scoreQuery.data ?? null;

  useEffect(() => {
    if (!existing) return;
    setDraft({
      relevance: existing.relevance,
      accuracy: existing.accuracy,
      novelty: existing.novelty,
    });
    setNote(existing.note ?? '');
  }, [existing]);

  const isComplete = RUBRIC_DIMENSIONS.every(
    (dimension) => draft[dimension] !== undefined
  );

  const submit = () => {
    if (!isComplete) return;
    mutation.mutate(
      {
        workspaceId: props.workspaceId,
        reportId: props.reportId,
        relevance: draft.relevance ?? RUBRIC_SCORE_MIN,
        accuracy: draft.accuracy ?? RUBRIC_SCORE_MIN,
        novelty: draft.novelty ?? RUBRIC_SCORE_MIN,
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast.success('Report score saved');
          void queryClient.invalidateQueries({
            queryKey: intelligenceQueries.reportScore(props.reportId).queryKey,
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
              setDraft((current) => ({ ...current, [dimension]: value }))
            }
          />
        ))}
        <label className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Note (optional)
          </span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={2000}
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
