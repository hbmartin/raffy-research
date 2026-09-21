/**
 * Temporary TanStack Start/WebKit compatibility boundary.
 *
 * Start's public hydrateStart wrapper reads window.$_TSR after awaiting route
 * imports. A previous document's import can finish after WebKit commits a hard
 * reload and signal the replacement document's private bootstrap state. Keep
 * the private API confined here until TanStack exposes document-bound ownership.
 */
const currentOwners = new WeakMap<Document, object>();

export const captureStartHydrationOwner = (document: Document) => {
  const view = document.defaultView;
  const bootstrap = view?.$_TSR;
  const token = {};
  let signaled = false;
  currentOwners.set(document, token);

  return {
    isCurrent: () =>
      view?.document === document &&
      currentOwners.get(document) === token &&
      (view?.$_TSR === bootstrap || (signaled && view?.$_TSR === undefined)),
    signal: () => {
      signaled = true;
      bootstrap?.h();
    },
  };
};
