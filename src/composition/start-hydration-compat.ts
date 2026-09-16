/**
 * Temporary TanStack Start/WebKit compatibility boundary.
 *
 * Start's public hydrateStart wrapper reads window.$_TSR after awaiting route
 * imports. A previous document's import can finish after WebKit commits a hard
 * reload and signal the replacement document's private bootstrap state. Keep
 * the private API confined here until TanStack exposes document-bound ownership.
 */
export const captureStartHydrationOwner = (document: Document) => {
  const view = document.defaultView;
  const bootstrap = view?.$_TSR;
  return {
    isCurrent: () => view?.document === document && view?.$_TSR === bootstrap,
    signal: () => bootstrap?.h(),
  };
};
