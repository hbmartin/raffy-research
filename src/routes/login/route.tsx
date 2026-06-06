import { createFileRoute, Outlet } from '@tanstack/react-router';
import { z } from 'zod';

import { PageError } from '@/platform/components/errors/page-error';
import { RouteError } from '@/platform/components/errors/route-error';

import {
  LayoutLogin,
  redirectAuthenticatedRoute,
} from '@/modules/auth/presentation';
import { observeBeforeLoad } from '@/platform/router/route-observability';

const searchSchema = z.looseObject({
  redirect: z.string().catch('').optional(),
});

export const Route = createFileRoute('/login')({
  validateSearch: searchSchema,
  beforeLoad: ({ context, search }) =>
    observeBeforeLoad('/login', () =>
      redirectAuthenticatedRoute({
        context,
        redirect: search.redirect,
      })
    ),
  component: RouteComponent,
  notFoundComponent: () => <PageError type="404" />,
  errorComponent: () => <RouteError />,
});

function RouteComponent() {
  return (
    <LayoutLogin>
      <Outlet />
    </LayoutLogin>
  );
}
