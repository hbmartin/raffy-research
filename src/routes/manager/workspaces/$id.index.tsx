import { createFileRoute } from '@tanstack/react-router';

import { isForbiddenRouteContext } from '@/modules/auth/presentation';
import { intelligenceQueries } from '@/modules/intelligence/client';
import { ManagerPageWorkspace } from '@/modules/intelligence/presentation';
import { toWorkspaceId } from '@/modules/kernel';
import { observedLoader } from '@/platform/router/route-observability';

export const Route = createFileRoute('/manager/workspaces/$id/')({
  loader: observedLoader('/manager/workspaces/$id/', ({ context, params }) => {
    if (isForbiddenRouteContext(context)) return undefined;
    return context.queryClient.ensureQueryData(
      intelligenceQueries.workspaceConfig(toWorkspaceId(params.id))
    );
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const params = Route.useParams();
  return <ManagerPageWorkspace workspaceId={toWorkspaceId(params.id)} />;
}
