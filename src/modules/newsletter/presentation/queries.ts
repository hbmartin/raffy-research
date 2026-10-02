import { queryOptions } from '@tanstack/react-query';

import type { ServerFunctionFacade } from '@/platform/lib/tanstack-start/server-function-types';

import type { NewsletterServerFunctions } from '../server';
export type NewsletterQueryFacade =
  ServerFunctionFacade<NewsletterServerFunctions>;
export const createNewsletterQueries = (facade: NewsletterQueryFacade) => ({
  workspace: (workspaceId: string) =>
    queryOptions({
      queryKey: ['newsletter', workspaceId],
      queryFn: () => facade.newsletterGet({ data: { workspaceId } }),
      refetchInterval: 5000,
    }),
});
