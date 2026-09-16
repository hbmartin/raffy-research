import { RouterProvider } from '@tanstack/react-router';
import { hydrateStart } from '@tanstack/start-client-core/client';
import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';

export const hydrateClient = async (document: Document) => {
  const bootstrap = window.$_TSR;
  const router = await hydrateStart();
  // WebKit can finish the previous document's route imports after a reload.
  // Signal completion only for the bootstrap state that this hydration owns.
  // The React Start wrapper reads window.$_TSR again after awaiting, which can
  // clear the replacement document's state before it starts hydrating.
  if (document.defaultView?.document !== document || bootstrap !== window.$_TSR)
    return;
  bootstrap?.h();
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>
    );
  });
};
