import { createFileRoute, notFound } from '@tanstack/react-router';

import { PageReport } from '@/modules/intelligence/presentation';
import { intelligenceGetReport } from '@/modules/intelligence/server';

export const Route = createFileRoute('/app/reports/$reportId')({
  loader: ({ params }) =>
    intelligenceGetReport({ data: { reportId: params.reportId } }),
  component: RouteComponent,
});

function RouteComponent() {
  const report = Route.useLoaderData();
  if (!report) throw notFound();

  return <PageReport report={report} />;
}
