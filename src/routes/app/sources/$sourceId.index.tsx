import { createFileRoute } from '@tanstack/react-router';

import { intelligenceQueries } from '@/modules/intelligence/client';
import { PageSource } from '@/modules/intelligence/presentation';
import { toSourceRecordId } from '@/modules/kernel';
import { observedLoader } from '@/platform/router/route-observability';

export const Route = createFileRoute('/app/sources/$sourceId/')({
  loader: observedLoader('/app/sources/$sourceId/', ({ context, params }) =>
    context.queryClient.ensureQueryData(
      intelligenceQueries.source(toSourceRecordId(params.sourceId))
    )
  ),
  component: RouteComponent,
});

function RouteComponent() {
  const params = Route.useParams();
  return <PageSource sourceId={toSourceRecordId(params.sourceId)} />;
}
