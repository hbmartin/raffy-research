import { RouterProvider } from '@tanstack/react-router';
import { hydrateStart } from '@tanstack/start-client-core/client';
import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';

import { HydrationCommit } from './hydration-commit';
import {
  handleClientHydrationFailure,
  isInitialHydrationDocumentActive,
} from './start-client-hydration';
import { captureStartHydrationOwner } from './start-hydration-compat';

export const hydrateClient = async (document: Document) => {
  const owner = captureStartHydrationOwner(document);
  let router: Awaited<ReturnType<typeof hydrateStart>>;
  try {
    router = await hydrateStart();
  } catch (error) {
    handleClientHydrationFailure(document, error, owner.isCurrent);
    return;
  }
  if (!owner.isCurrent() || !isInitialHydrationDocumentActive(document)) return;
  owner.signal();
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <HydrationCommit document={document} isCurrent={owner.isCurrent}>
          <RouterProvider router={router} />
        </HydrationCommit>
      </StrictMode>,
      {
        onUncaughtError: (error) => {
          handleClientHydrationFailure(
            document,
            error,
            owner.isCurrent,
            'root'
          );
        },
      }
    );
  });
};
