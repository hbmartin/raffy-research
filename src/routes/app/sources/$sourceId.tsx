import { createFileRoute, notFound } from '@tanstack/react-router';

import { PageSource } from '@/modules/intelligence/presentation';
import { intelligenceGetSource } from '@/modules/intelligence/server';

export const Route = createFileRoute('/app/sources/$sourceId')({
  loader: ({ params }) =>
    intelligenceGetSource({ data: { sourceId: params.sourceId } }),
  component: RouteComponent,
});

function RouteComponent() {
  const source = Route.useLoaderData();
  if (!source) throw notFound();

  return <PageSource source={source} />;
}
