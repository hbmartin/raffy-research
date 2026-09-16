import './platform/lib/zod/browser-config';

import { reportHydrationFailure } from './composition/hydration-failure';

// Keep schema-bearing application chunks behind this boundary so their module
// initialization cannot run before the CSP-safe Zod configuration.
const initialDocument = document;
const isCurrentDocument = () =>
  initialDocument.defaultView?.document === initialDocument;
const reportInitialHydrationFailure = (error: unknown) =>
  reportHydrationFailure(initialDocument, error);

void import('./composition/hydrate-client')
  .then(({ hydrateClient }) =>
    isCurrentDocument() ? hydrateClient(initialDocument) : undefined
  )
  .catch(reportInitialHydrationFailure);
