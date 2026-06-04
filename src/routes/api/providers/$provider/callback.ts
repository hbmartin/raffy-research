import { createFileRoute } from '@tanstack/react-router';

import { handleProviderCallbackRequest } from '@/modules/intelligence/backend';

export const Route = createFileRoute('/api/providers/$provider/callback')({
  server: {
    handlers: {
      POST: ({ params, request }) =>
        handleProviderCallbackRequest({
          provider: params.provider,
          request,
        }),
    },
  },
});
