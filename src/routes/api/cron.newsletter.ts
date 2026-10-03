import { createFileRoute } from '@tanstack/react-router';
import { createHash, timingSafeEqual } from 'node:crypto';

import { drainNewsletterQueue } from '@/composition/newsletter';
import { getCronSecret } from '@/modules/intelligence/backend';

export const Route = createFileRoute('/api/cron/newsletter')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = getCronSecret();
        const provided = request.headers.get('authorization') ?? '';
        const digest = (value: string) =>
          createHash('sha256').update(value).digest();
        if (
          !secret ||
          !timingSafeEqual(digest(provided), digest(`Bearer ${secret}`))
        )
          return new Response('Unauthorized', { status: 401 });
        await drainNewsletterQueue('hosted', 1);
        return Response.json({ status: 'processed' });
      },
    },
  },
});
