import { createFileRoute } from '@tanstack/react-router';

import { handleWeeklyReportsCronRequest } from '@/modules/intelligence/backend';

export const Route = createFileRoute('/api/cron/weekly-reports')({
  server: {
    handlers: {
      GET: ({ request }) => handleWeeklyReportsCronRequest(request),
    },
  },
});
