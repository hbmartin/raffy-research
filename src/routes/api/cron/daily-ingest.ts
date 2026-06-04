import { createFileRoute } from '@tanstack/react-router';

import { handleDailyIngestCronRequest } from '@/modules/intelligence/backend';

export const Route = createFileRoute('/api/cron/daily-ingest')({
  server: {
    handlers: {
      GET: ({ request }) => handleDailyIngestCronRequest(request),
    },
  },
});
