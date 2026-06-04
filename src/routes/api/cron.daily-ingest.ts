import { createFileRoute } from '@tanstack/react-router';

import { handleDailyIngestCron } from '@/composition/intelligence-jobs';

export const Route = createFileRoute('/api/cron/daily-ingest')({
  server: {
    handlers: {
      GET: ({ request }) => handleDailyIngestCron(request),
      POST: ({ request }) => handleDailyIngestCron(request),
    },
  },
});
