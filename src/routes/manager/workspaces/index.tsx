import { createFileRoute } from '@tanstack/react-router';

import { PageWorkspaces } from '@/modules/intelligence/presentation';
import { intelligenceListWorkspaces } from '@/modules/intelligence/server';

export const Route = createFileRoute('/manager/workspaces/')({
  loader: () => intelligenceListWorkspaces(),
  component: RouteComponent,
});

function RouteComponent() {
  const workspaces = Route.useLoaderData();

  return <PageWorkspaces workspaces={workspaces} />;
}
