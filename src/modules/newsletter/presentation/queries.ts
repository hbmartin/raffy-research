import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import type { ServerFunctionFacade } from '@/platform/lib/tanstack-start/server-function-types';

import type { NewsletterServerFunctions } from '../server';
export type NewsletterQueryFacade =
  ServerFunctionFacade<NewsletterServerFunctions>;
export const createNewsletterQueries = (facade: NewsletterQueryFacade) => ({
  history: (workspaceId: string) =>
    infiniteQueryOptions({
      queryKey: ['newsletter-history', workspaceId],
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) =>
        facade.newsletterHistory({ data: { workspaceId, before: pageParam } }),
      getNextPageParam: (page) =>
        page.type === 'history_found'
          ? (page.nextCursor ?? undefined)
          : undefined,
    }),
  detail: (workspaceId: string, id: string) =>
    queryOptions({
      queryKey: ['newsletter-detail', workspaceId, id],
      queryFn: () => facade.newsletterDetail({ data: { workspaceId, id } }),
    }),
  evidence: (workspaceId: string, sourceIds: string[]) =>
    queryOptions({
      queryKey: ['newsletter-evidence', workspaceId, sourceIds],
      queryFn: () =>
        facade.newsletterEvidenceDetails({ data: { workspaceId, sourceIds } }),
    }),
  duplicates: (workspaceId: string) =>
    infiniteQueryOptions({
      queryKey: ['newsletter-duplicates', workspaceId],
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) =>
        facade.newsletterEquivalenceReviews({
          data: { workspaceId, before: pageParam },
        }),
      getNextPageParam: (page) =>
        page.type === 'reviews_found'
          ? (page.nextCursor ?? undefined)
          : undefined,
    }),
  workspace: (workspaceId: string) =>
    queryOptions({
      queryKey: ['newsletter', workspaceId],
      queryFn: () => facade.newsletterGet({ data: { workspaceId } }),
      refetchInterval: (query) => {
        const data = query.state.data;
        return data?.type === 'newsletter_found' &&
          data.jobs.some(
            (job) => job.status === 'queued' || job.status === 'running'
          )
          ? 5000
          : false;
      },
      refetchOnWindowFocus: true,
    }),
});
