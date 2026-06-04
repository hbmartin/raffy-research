import { createFileRoute, redirect } from '@tanstack/react-router';

import { PageLatestReportEmpty } from '@/modules/intelligence/presentation';
import { intelligenceGetLatestReport } from '@/modules/intelligence/server';

export const Route = createFileRoute('/app/')({
  beforeLoad: async ({ context }) => {
    const currentSession = await context.auth.getSession();
    if (!currentSession?.user.onboardedAt) return;

    const latest = await intelligenceGetLatestReport({ data: {} });
    if (latest?.report) {
      throw redirect({
        to: '/app/reports/$reportId',
        params: { reportId: latest.report.id },
      });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  return <PageLatestReportEmpty />;
}
