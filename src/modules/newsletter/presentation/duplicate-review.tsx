import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/platform/components/ui/button';

import { newsletterQueries } from './wired-queries';
import { newsletterDecideEquivalence } from '../server';

export function DuplicateReview({
  workspaceId,
  onChanged,
}: {
  workspaceId: string;
  onChanged: () => void;
}) {
  const [conflict, setConflict] = useState<
    import('@/modules/intelligence').EquivalenceConflict | null
  >(null);
  const [open, setOpen] = useState(false);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const evidence = useQuery({
    ...newsletterQueries.evidence(workspaceId, sourceIds),
    enabled: open && sourceIds.length > 0,
  });
  const reviews = useInfiniteQuery({
    ...newsletterQueries.duplicates(workspaceId),
    enabled: open,
  });
  const decision = useMutation({
    mutationFn: ({
      reviewId,
      action,
    }: {
      reviewId: string;
      action: 'confirm' | 'separate' | 'reverse';
    }) =>
      newsletterDecideEquivalence({ data: { workspaceId, reviewId, action } }),
    onSuccess: async (outcome) => {
      if (outcome.type === 'equivalence_conflict') {
        setConflict(outcome);
        return;
      }
      if (outcome.type !== 'saved') {
        toast.error('This duplicate decision could not be saved');
        return;
      }
      setConflict(null);
      toast.success('Evidence equivalence decision saved');
      onChanged();
      await reviews.refetch();
    },
    onError: () => toast.error('Duplicate decision failed'),
  });
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer font-medium">
        Review possible duplicate evidence
      </summary>
      <p className="mt-2 text-sm text-muted-foreground">
        Uncertain copies stay separate until confirmed. Keep/Junk judgments
        apply to confirmed equivalent content. Changed versions can remain
        separate.
      </p>
      {reviews.isError ? (
        <p role="alert">Duplicate reviews could not be loaded.</p>
      ) : null}
      {conflict ? (
        <div role="alert" className="mt-3 rounded-md border p-3 text-sm">
          <p>{conflict.message}</p>
          {conflict.blockingReviews.map((review) => (
            <div key={review.id} className="mt-2 break-words">
              <p>
                {review.leftSourceId} ↔ {review.rightSourceId} ({review.status})
              </p>
              <Button
                disabled={decision.isPending}
                variant="secondary"
                onClick={() =>
                  decision.mutate({ reviewId: review.id, action: 'reverse' })
                }
              >
                Reverse{' '}
                {review.status === 'confirmed' ? 'confirmation' : 'separation'}
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      <ul className="mt-3 space-y-3">
        {reviews.data?.pages
          .flatMap((page) =>
            page.type === 'reviews_found' ? page.reviews : []
          )
          .map((review) => (
            <li key={review.id} className="rounded-md border p-3 text-sm">
              <p className="break-words">
                {review.leftTitle} · {review.rightTitle}
              </p>
              <p className="text-muted-foreground">{review.status}</p>
              <Button
                variant="ghost"
                onClick={() =>
                  setSourceIds([review.leftSourceId, review.rightSourceId])
                }
              >
                Compare captured text
              </Button>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={decision.isPending}
                  onClick={() =>
                    decision.mutate({ reviewId: review.id, action: 'confirm' })
                  }
                >
                  Confirm equivalent content
                </Button>
                <Button
                  variant="ghost"
                  disabled={decision.isPending}
                  onClick={() =>
                    decision.mutate({ reviewId: review.id, action: 'reverse' })
                  }
                >
                  Reverse decision
                </Button>
                <Button
                  variant="ghost"
                  disabled={decision.isPending}
                  onClick={() =>
                    decision.mutate({ reviewId: review.id, action: 'separate' })
                  }
                >
                  Keep versions separate
                </Button>
              </div>
            </li>
          ))}
      </ul>
      {evidence.isError ? (
        <p role="alert">Captured text could not be loaded.</p>
      ) : null}
      {evidence.data?.type === 'evidence_found' ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {evidence.data.sources.map((source) => (
            <article key={source.id} className="min-w-0 rounded-md border p-3">
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium break-words"
              >
                {source.title}
              </a>
              <p className="text-xs text-muted-foreground">
                Published {source.publishedAt.slice(0, 10)} · Captured{' '}
                {source.capturedAt.slice(0, 10)}
              </p>
              <pre className="mt-2 max-h-96 overflow-auto text-xs break-words whitespace-pre-wrap">
                {source.content}
              </pre>
            </article>
          ))}
        </div>
      ) : null}
      {reviews.hasNextPage ? (
        <Button
          variant="secondary"
          onClick={() => void reviews.fetchNextPage()}
          disabled={reviews.isFetchingNextPage}
        >
          Load twenty more
        </Button>
      ) : null}
    </details>
  );
}
