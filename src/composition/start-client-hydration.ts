import { reportHydrationFailure } from './hydration-failure';

type HydrationModule = {
  hydrateClient(document: Document): Promise<void>;
};

type StartClientHydrationOptions = {
  document: Document;
  loadHydrationModule: () => Promise<HydrationModule>;
};

const exitingDocuments = new WeakSet<Document>();
const tentativeExits = new WeakMap<Document, Promise<void>>();
const resolveTentativeExits = new WeakMap<Document, () => void>();
const committedDocuments = new WeakSet<Document>();
const reloadRequestedDocuments = new WeakSet<Document>();
const commitCallbacks = new WeakMap<Document, () => void>();

export const markInitialHydrationCommitted = (document: Document) => {
  if (committedDocuments.has(document)) return;
  committedDocuments.add(document);
  commitCallbacks.get(document)?.();
  commitCallbacks.delete(document);
};

export const hasInitialHydrationCommitted = (document: Document) =>
  committedDocuments.has(document);

export const isInitialHydrationDocumentActive = (document: Document) => {
  const view = document.defaultView;
  return (
    !exitingDocuments.has(document) &&
    !reloadRequestedDocuments.has(document) &&
    !tentativeExits.has(document) &&
    view?.document === document
  );
};

export const shouldReportInitialHydrationFailure = async (
  document: Document
) => {
  // The rejection can precede the navigation event by one task.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await tentativeExits.get(document);
  return isInitialHydrationDocumentActive(document);
};

export const startClientHydration = ({
  document,
  loadHydrationModule,
}: StartClientHydrationOptions) => {
  const view = document.defaultView;
  let tentativeExitTimer: ReturnType<typeof setTimeout> | undefined;
  const clearTentativeExit = () => {
    if (tentativeExitTimer) clearTimeout(tentativeExitTimer);
    tentativeExitTimer = undefined;
    tentativeExits.delete(document);
    resolveTentativeExits.get(document)?.();
    resolveTentativeExits.delete(document);
  };
  const markPageMaybeExiting = () => {
    if (tentativeExits.has(document)) return;
    tentativeExits.set(
      document,
      new Promise<void>((resolve) => {
        resolveTentativeExits.set(document, resolve);
        tentativeExitTimer = setTimeout(() => {
          clearTentativeExit();
        }, 1_000);
      })
    );
  };
  const markPageExiting = () => {
    exitingDocuments.add(document);
    clearTentativeExit();
  };
  const markPageRestored = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    exitingDocuments.delete(document);
    clearTentativeExit();
    if (
      !hasInitialHydrationCommitted(document) &&
      !reloadRequestedDocuments.has(document)
    ) {
      reloadRequestedDocuments.add(document);
      view?.location.reload();
    }
  };

  view?.addEventListener('beforeunload', markPageMaybeExiting);
  view?.addEventListener('pagehide', markPageExiting);
  view?.addEventListener('pageshow', markPageRestored);
  commitCallbacks.set(document, () => {
    view?.removeEventListener('beforeunload', markPageMaybeExiting);
    clearTentativeExit();
  });

  return loadHydrationModule()
    .then(async ({ hydrateClient }) => {
      await tentativeExits.get(document);
      if (isInitialHydrationDocumentActive(document))
        return hydrateClient(document);
      return undefined;
    })
    .catch(async (error: unknown) => {
      if (await shouldReportInitialHydrationFailure(document))
        reportHydrationFailure(document, error);
    });
};
