import { createFileRoute, Outlet } from '@tanstack/react-router';
import { z } from 'zod';

import { PageError } from '@/platform/components/errors/page-error';
import { RouteError } from '@/platform/components/errors/route-error';

import { requireOnboardingRoute } from '@/modules/auth/presentation';
import { observeBeforeLoad } from '@/platform/router/route-observability';

const searchSchema = z.object({
  redirect: z.string().catch('').optional(),
});

export const Route = createFileRoute('/onboarding')({
  validateSearch: searchSchema,
  beforeLoad: ({ context, location, search }) =>
    observeBeforeLoad('/onboarding', () =>
      requireOnboardingRoute({
        context,
        location,
        redirect: search.redirect,
      })
    ),
  component: Outlet,
  notFoundComponent: () => <PageError type="404" />,
  errorComponent: () => <RouteError />,
});
