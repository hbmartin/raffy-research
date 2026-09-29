import {
  reportHydrationFailure,
  reportRootFailure,
  showClientRecovery,
} from './hydration-failure';

type HydrationModule = {
  hydrateClient(document: Document): Promise<void>;
};
type PendingFailure = {
  error: unknown;
  isCurrent: () => boolean;
  event: 'client.hydration_failed' | 'client.root_uncaught';
  recorded: boolean;
};
type Lifecycle = {
  tentativeDeparture: boolean;
  departed: boolean;
  committed: boolean;
  reloadRequested: boolean;
  failures: PendingFailure[];
  recordedErrors: Set<unknown>;
};
const lifecycles = new WeakMap<Document, Lifecycle>();
const coordinators = new WeakMap<Document, object>();
const ownsDocument = (document: Document) =>
  document.defaultView?.document === document;

const reportFailure = (
  document: Document,
  failure: PendingFailure,
  showRecovery: boolean
) => {
  if (failure.event === 'client.root_uncaught')
    reportRootFailure(document, failure.error, showRecovery);
  else if (showRecovery) reportHydrationFailure(document, failure.error);
  else reportHydrationFailure(document, failure.error, false);
  failure.recorded = true;
};

const lifecycleFor = (document: Document): Lifecycle => {
  const existing = lifecycles.get(document);
  if (existing) return existing;
  const state: Lifecycle = {
    tentativeDeparture: false,
    departed: false,
    committed: false,
    reloadRequested: false,
    failures: [],
    recordedErrors: new Set(),
  };
  lifecycles.set(document, state);
  const view = document.defaultView;
  const resume = () => {
    if (!ownsDocument(document) || state.departed || state.reloadRequested)
      return;
    state.tentativeDeparture = false;
    for (const failure of state.failures.splice(0)) {
      if (!failure.isCurrent()) continue;
      if (!failure.recorded) reportFailure(document, failure, true);
      else showClientRecovery(document, failure.event);
    }
  };
  view?.addEventListener('beforeunload', () => {
    if (ownsDocument(document)) state.tentativeDeparture = true;
  });
  view?.addEventListener('pagehide', () => {
    if (!ownsDocument(document)) return;
    state.departed = true;
    state.tentativeDeparture = false;
    // Only actual React errors survive a cache restore. Import failures during
    // navigation are indistinguishable from the browser cancelling a request.
    state.failures = state.failures.filter((failure) => failure.recorded);
  });
  view?.addEventListener('pageshow', (event) => {
    if (!ownsDocument(document)) return;
    if (event.persisted) {
      state.departed = false;
      if (!state.committed && !state.reloadRequested) {
        state.reloadRequested = true;
        view.location.reload();
      }
    }
    resume();
  });
  view?.addEventListener('focus', resume);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resume();
  });
  const resumeOnInteraction = (event: Event) => {
    if (event.isTrusted) resume();
  };
  view?.addEventListener('pointerdown', resumeOnInteraction, { capture: true });
  view?.addEventListener('keydown', resumeOnInteraction, { capture: true });
  return state;
};

export const markInitialHydrationCommitted = (document: Document) => {
  if (isInitialHydrationDocumentActive(document))
    lifecycleFor(document).committed = true;
};
export const hasInitialHydrationCommitted = (document: Document) =>
  lifecycleFor(document).committed;
export const isInitialHydrationDocumentActive = (document: Document) => {
  const state = lifecycleFor(document);
  return ownsDocument(document) && !state.departed && !state.reloadRequested;
};

export const handleClientHydrationFailure = (
  document: Document,
  error: unknown,
  isCurrent: () => boolean = () => true,
  source: 'bootstrap' | 'root' = 'bootstrap'
) => {
  const state = lifecycleFor(document);
  if (!ownsDocument(document) || !isCurrent() || state.reloadRequested) return;
  if (source === 'bootstrap' && state.departed) return;
  if (state.recordedErrors.has(error)) return;
  state.recordedErrors.add(error);
  const failure: PendingFailure = {
    error,
    isCurrent,
    recorded: false,
    event:
      source === 'root' && state.committed
        ? 'client.root_uncaught'
        : 'client.hydration_failed',
  };
  const leaving = state.tentativeDeparture || state.departed;
  // Actual root errors are recorded immediately, even while recovery UI is quiet.
  if (source === 'root' || !leaving) reportFailure(document, failure, !leaving);
  if (leaving) state.failures.push(failure);
};

export const startClientHydration = ({
  document,
  loadHydrationModule,
}: {
  document: Document;
  loadHydrationModule: () => Promise<HydrationModule>;
}) => {
  lifecycleFor(document);
  const token = {};
  coordinators.set(document, token);
  const isCurrent = () => coordinators.get(document) === token;
  return loadHydrationModule()
    .then(({ hydrateClient }) => {
      if (isCurrent() && isInitialHydrationDocumentActive(document))
        return hydrateClient(document);
      return undefined;
    })
    .catch((error: unknown) =>
      handleClientHydrationFailure(document, error, isCurrent)
    );
};
