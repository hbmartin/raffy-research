import { reportHydrationFailure } from './hydration-failure';

type HydrationModule = {
  hydrateClient(document: Document): Promise<void>;
};

type StartClientHydrationOptions = {
  document: Document;
  loadHydrationModule: () => Promise<HydrationModule>;
};

const exitingDocuments = new WeakSet<Document>();

export const isInitialHydrationDocumentActive = (document: Document) => {
  const view = document.defaultView;
  return (
    !exitingDocuments.has(document) &&
    document.defaultView === view &&
    view?.document === document
  );
};

export const shouldReportInitialHydrationFailure = async (
  document: Document
) => {
  // A navigation-triggered import rejection can arrive just before the
  // browser dispatches beforeunload/pagehide. Give those signals one task.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return isInitialHydrationDocumentActive(document);
};

export const startClientHydration = ({
  document,
  loadHydrationModule,
}: StartClientHydrationOptions) => {
  const view = document.defaultView;
  const markPageExiting = () => {
    exitingDocuments.add(document);
  };

  view?.addEventListener('beforeunload', markPageExiting, { once: true });
  view?.addEventListener('pagehide', markPageExiting, { once: true });

  return loadHydrationModule()
    .then(({ hydrateClient }) =>
      isInitialHydrationDocumentActive(document)
        ? hydrateClient(document)
        : undefined
    )
    .catch(async (error: unknown) => {
      if (await shouldReportInitialHydrationFailure(document))
        reportHydrationFailure(document, error);
    });
};
