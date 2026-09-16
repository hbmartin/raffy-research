import { RouterProvider } from '@tanstack/react-router';
import { hydrateStart } from '@tanstack/start-client-core/client';
import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';

import { reportHydrationFailure } from './hydration-failure';
import { captureStartHydrationOwner } from './start-hydration-compat';

export const hydrateClient = async (document: Document) => {
  const owner = captureStartHydrationOwner(document);
  const router = await hydrateStart();
  if (!owner.isCurrent()) return;
  owner.signal();
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
      {
        onUncaughtError: (error) => {
          if (owner.isCurrent()) reportHydrationFailure(document, error);
        },
      }
    );
  });
};
