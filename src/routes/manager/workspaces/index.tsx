import { createFileRoute } from '@tanstack/react-router';

import { isForbiddenRouteContext } from '@/modules/auth/presentation';
import { intelligenceQueries } from '@/modules/intelligence/client';
import { ManagerPageWorkspaces } from '@/modules/intelligence/presentation';
import { observedLoader } from '@/platform/router/route-observability';

export const Route = createFileRoute('/manager/workspaces/')({
  loader: observedLoader('/manager/workspaces/', ({ context }) => {
    if (isForbiddenRouteContext(context)) return undefined;
    return context.queryClient.ensureQueryData(
      intelligenceQueries.workspaces()
    );
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <ManagerPageWorkspaces />;
}
