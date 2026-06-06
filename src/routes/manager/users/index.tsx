import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { z } from 'zod';

import { isForbiddenRouteContext } from '@/modules/auth/presentation';
import { toScopeKey } from '@/modules/kernel';
import { userQueries } from '@/modules/user/client';
import { PageUsers } from '@/modules/user/presentation';
import { observedLoader } from '@/platform/router/route-observability';

const searchSchema = z.object({
  searchTerm: z.string().catch('').optional(),
});

export const Route = createFileRoute('/manager/users/')({
  validateSearch: searchSchema,
  search: {
    middlewares: [stripSearchParams({ searchTerm: '' })],
  },
  loaderDeps: ({ search }) => ({ searchTerm: search.searchTerm ?? '' }),
  component: RouteComponent,
  loader: observedLoader('/manager/users/', ({ context, deps }) => {
    if (isForbiddenRouteContext(context)) return undefined;

    return context.queryClient.ensureInfiniteQueryData(
      userQueries.getAllInfinite({
        scopeKey: toScopeKey(context.scopeKey),
        searchTerm: deps.searchTerm,
      })
    );
  }),
});

function RouteComponent() {
  const search = Route.useSearch();
  return <PageUsers search={search} />;
}
