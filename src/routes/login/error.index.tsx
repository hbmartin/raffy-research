import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { PageLoginError } from '@/modules/auth/presentation';

const searchSchema = z.object({
  error: z.string().catch('').optional(),
});

export const Route = createFileRoute('/login/error/')({
  component: RouteComponent,
  validateSearch: searchSchema,
});

function RouteComponent() {
  const search = Route.useSearch();
  return <PageLoginError search={search} />;
}
