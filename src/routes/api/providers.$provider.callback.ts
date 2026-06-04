import { createFileRoute } from '@tanstack/react-router';

import { handleProviderCallbackRequest } from '@/composition/intelligence-jobs';

export const Route = createFileRoute('/api/providers/$provider/callback')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleProviderCallbackRequest(params.provider, request),
    },
  },
});
