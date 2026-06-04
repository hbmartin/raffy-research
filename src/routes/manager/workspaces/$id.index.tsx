import { createFileRoute, notFound } from '@tanstack/react-router';

import { PageWorkspaceDetail } from '@/modules/intelligence/presentation';
import { intelligenceGetWorkspace } from '@/modules/intelligence/server';

export const Route = createFileRoute('/manager/workspaces/$id/')({
  loader: ({ params }) =>
    intelligenceGetWorkspace({ data: { workspaceId: params.id } }),
  component: RouteComponent,
});

function RouteComponent() {
  const workspace = Route.useLoaderData();
  if (!workspace) throw notFound();

  return (
    <PageWorkspaceDetail
      callbacks={workspace.callbacks}
      configuration={workspace.configuration}
    />
  );
}
