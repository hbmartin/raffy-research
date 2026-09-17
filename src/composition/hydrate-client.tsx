import { RouterProvider } from '@tanstack/react-router';
import { hydrateStart } from '@tanstack/start-client-core/client';
import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';

import { reportHydrationFailure } from './hydration-failure';
import {
  isInitialHydrationDocumentActive,
  shouldReportInitialHydrationFailure,
} from './start-client-hydration';
import { captureStartHydrationOwner } from './start-hydration-compat';

export const hydrateClient = async (document: Document) => {
  const owner = captureStartHydrationOwner(document);
  let router: Awaited<ReturnType<typeof hydrateStart>>;
  try {
    router = await hydrateStart();
  } catch (error) {
    if (
      (await shouldReportInitialHydrationFailure(document)) &&
      owner.isCurrent()
    )
      reportHydrationFailure(document, error);
    return;
  }
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
          if (isInitialHydrationDocumentActive(document) && owner.isCurrent())
            reportHydrationFailure(document, error);
        },
      }
    );
  });
};
