import { createFileRoute } from '@tanstack/react-router';

import { intelligenceQueries } from '@/modules/intelligence/client';
import { PageLatestReport } from '@/modules/intelligence/presentation';
import { observedLoader } from '@/platform/router/route-observability';

export const Route = createFileRoute('/app/')({
  loader: observedLoader('/app/', ({ context }) =>
    context.queryClient.ensureQueryData(intelligenceQueries.latestReport())
  ),
  component: RouteComponent,
});

function RouteComponent() {
  return <PageLatestReport />;
}
