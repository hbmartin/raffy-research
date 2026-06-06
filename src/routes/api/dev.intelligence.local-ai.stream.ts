import { createFileRoute } from '@tanstack/react-router';

import { handleLocalAiStreamRequest } from '@/composition/intelligence-local-ai';

export const Route = createFileRoute('/api/dev/intelligence/local-ai/stream')({
  server: {
    handlers: {
      POST: ({ request }) => handleLocalAiStreamRequest(request),
    },
  },
});
