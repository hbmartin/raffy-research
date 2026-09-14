import './platform/lib/zod/browser-config';

// Keep schema-bearing application chunks behind this boundary so their module
// initialization cannot run before the CSP-safe Zod configuration.
const initialDocument = document;
void import('./composition/hydrate-client').then(({ hydrateClient }) => {
  // An import may finish after a hard reload in WebKit. Never bootstrap the
  // replacement document from the previous document's pending import.
  if (initialDocument.defaultView?.document !== initialDocument) return;
  return hydrateClient(initialDocument);
});
