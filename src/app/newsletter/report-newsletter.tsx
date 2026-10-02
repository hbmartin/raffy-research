import { useSuspenseQuery } from '@tanstack/react-query';

import { intelligenceQueries } from '@/modules/intelligence/client';
import { toWeeklyReportId } from '@/modules/kernel';
import { NewsletterPanel } from '@/modules/newsletter/presentation';

export function LatestReportNewsletter() {
  const { data } = useSuspenseQuery(intelligenceQueries.latestReport());
  return data.workspaceId ? (
    <div className="mt-8 border-t pt-8 pb-4">
      <NewsletterPanel
        workspaceId={data.workspaceId}
        reportId={data.report?.id ?? ''}
      />
    </div>
  ) : null;
}
export function ReportNewsletter({ reportId }: { reportId: string }) {
  const { data } = useSuspenseQuery(
    intelligenceQueries.report(toWeeklyReportId(reportId))
  );
  return (
    <div className="mt-8 border-t pt-8 pb-4">
      <NewsletterPanel workspaceId={data.workspaceId} reportId={data.id} />
    </div>
  );
}
