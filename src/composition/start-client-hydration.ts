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
  noticeScheduled: boolean;
};
type Lifecycle = {
  tentativeDeparture: boolean;
  departed: boolean;
  committed: boolean;
  reloadRequested: boolean;
  failures: PendingFailure[];
  recordedErrors: Set<unknown>;
  resume: () => void;
};
const lifecycles = new WeakMap<Document, Lifecycle>();
const coordinators = new WeakMap<Document, object>();
// WebKit can withhold beforeunload until a slow document response commits.
// Give that navigation time to reach pagehide before classifying an import error.
const IMPORT_FAILURE_SETTLE_MS = 2_000;
const ownsDocument = (document: Document) =>
  document.defaultView?.document === document;

const reportFailure = (document: Document, failure: PendingFailure) => {
  if (failure.event === 'client.root_uncaught')
    reportRootFailure(document, failure.error, false);
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
    resume: () => {},
  };
  lifecycles.set(document, state);
  const view = document.defaultView;
  const scheduleRecovery = (failure: PendingFailure) => {
    if (failure.noticeScheduled) return;
    failure.noticeScheduled = true;
    setTimeout(() => {
      failure.noticeScheduled = false;
      if (
        !ownsDocument(document) ||
        !failure.isCurrent() ||
        state.departed ||
        state.reloadRequested ||
        state.tentativeDeparture ||
        document.visibilityState === 'hidden'
      )
        return;
      showClientRecovery(document, failure.event);
      state.failures = state.failures.filter((pending) => pending !== failure);
    }, 0);
  };
  const resume = () => {
    if (!ownsDocument(document) || state.departed || state.reloadRequested)
      return;
    if (document.visibilityState === 'hidden') return;
    state.tentativeDeparture = false;
    state.failures = state.failures.filter((failure) => failure.isCurrent());
    for (const failure of state.failures) {
      if (!failure.recorded) reportFailure(document, failure);
      scheduleRecovery(failure);
    }
  };
  state.resume = resume;
  view?.addEventListener('beforeunload', () => {
    if (ownsDocument(document)) {
      state.tentativeDeparture = true;
    }
  });
  view?.addEventListener('pagehide', () => {
    if (!ownsDocument(document)) return;
    state.departed = true;
    state.tentativeDeparture = false;
    // An import canceled by a completed navigation is not an application error.
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
    if (event.persisted || state.tentativeDeparture) resume();
  });
  view?.addEventListener('focus', () => {
    if (state.tentativeDeparture) resume();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      state.tentativeDeparture = true;
    } else if (
      document.visibilityState === 'visible' &&
      state.tentativeDeparture
    )
      resume();
  });
  const resumeOnInteraction = (event: Event) => {
    if (!event.isTrusted) return;
    // An input event can still occur while a slow navigation is in flight.
    // Keep uncertain imports pending long enough for pagehide to settle it.
    if (state.failures.some((failure) => !failure.recorded))
      setTimeout(resume, IMPORT_FAILURE_SETTLE_MS);
    else resume();
  };
  // Click includes assistive-technology activation. Delaying recovery until a
  // later task lets the activating event finish before the overlay is inserted.
  view?.addEventListener('click', resumeOnInteraction, { capture: true });
  view?.addEventListener('keyup', resumeOnInteraction, { capture: true });
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
  source: 'module_import' | 'hydrate_start' | 'root' = 'module_import'
) => {
  const state = lifecycleFor(document);
  if (!ownsDocument(document) || !isCurrent() || state.reloadRequested) return;
  if (source === 'module_import' && state.departed) return;
  if (state.recordedErrors.has(error)) return;
  state.recordedErrors.add(error);
  const failure: PendingFailure = {
    error,
    isCurrent,
    recorded: false,
    noticeScheduled: false,
    event:
      source === 'root' && state.committed
        ? 'client.root_uncaught'
        : 'client.hydration_failed',
  };
  state.failures.push(failure);
  // Import failures during departure may be canceled requests. Other failures
  // have reached application code and can be recorded even while leaving.
  if (source !== 'module_import') {
    reportFailure(document, failure);
    if (!state.tentativeDeparture && !state.departed) state.resume();
  } else if (!state.tentativeDeparture && !state.departed) {
    setTimeout(() => state.resume(), IMPORT_FAILURE_SETTLE_MS);
  }
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
  return loadHydrationModule().then(
    ({ hydrateClient }) => {
      if (isCurrent() && isInitialHydrationDocumentActive(document))
        return Promise.resolve()
          .then(() => hydrateClient(document))
          .catch((error: unknown) =>
            handleClientHydrationFailure(
              document,
              error,
              isCurrent,
              'hydrate_start'
            )
          );
      return undefined;
    },
    (error: unknown) => handleClientHydrationFailure(document, error, isCurrent)
  );
};
