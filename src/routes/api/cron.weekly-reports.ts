import { createFileRoute } from '@tanstack/react-router';

import { handleWeeklyReportsCron } from '@/composition/intelligence-jobs';

export const Route = createFileRoute('/api/cron/weekly-reports')({
  server: {
    handlers: {
      GET: ({ request }) => handleWeeklyReportsCron(request),
      POST: ({ request }) => handleWeeklyReportsCron(request),
    },
  },
});
