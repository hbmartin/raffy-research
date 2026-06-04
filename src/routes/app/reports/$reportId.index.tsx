import { createFileRoute } from '@tanstack/react-router';

import { intelligenceQueries } from '@/modules/intelligence/client';
import { PageReport } from '@/modules/intelligence/presentation';
import { toWeeklyReportId } from '@/modules/kernel';
import { observedLoader } from '@/platform/router/route-observability';

export const Route = createFileRoute('/app/reports/$reportId/')({
  loader: observedLoader('/app/reports/$reportId/', ({ context, params }) =>
    context.queryClient.ensureQueryData(
      intelligenceQueries.report(toWeeklyReportId(params.reportId))
    )
  ),
  component: RouteComponent,
});

function RouteComponent() {
  const params = Route.useParams();
  return <PageReport reportId={toWeeklyReportId(params.reportId)} />;
}
