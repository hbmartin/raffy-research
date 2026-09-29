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
  status: 'pending' | 'reported' | 'scheduled' | 'shown';
};
type Lifecycle = {
  tentativeDeparture: boolean;
  departed: boolean;
  committed: boolean;
  reloadRequested: boolean;
  failures: Map<unknown, PendingFailure>;
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
  failure.status = 'reported';
};

const resumeRecovery = (document: Document, state: Lifecycle) => {
  if (
    !ownsDocument(document) ||
    state.departed ||
    state.reloadRequested ||
    document.visibilityState === 'hidden'
  )
    return;
  state.tentativeDeparture = false;
  for (const [error, failure] of state.failures) {
    if (!failure.isCurrent()) {
      state.failures.delete(error);
      continue;
    }
    if (failure.status === 'pending') reportFailure(document, failure);
    if (failure.status !== 'reported') continue;
    failure.status = 'scheduled';
    // Let a click finish before inserting a notice over its target.
    setTimeout(() => {
      if (
        !ownsDocument(document) ||
        !failure.isCurrent() ||
        state.departed ||
        state.reloadRequested ||
        state.tentativeDeparture ||
        document.visibilityState === 'hidden'
      ) {
        failure.status = 'reported';
        return;
      }
      showClientRecovery(document, failure.event);
      failure.status = 'shown';
    }, 0);
  }
};

const lifecycleFor = (document: Document): Lifecycle => {
  const existing = lifecycles.get(document);
  if (existing) return existing;
  const state: Lifecycle = {
    tentativeDeparture: false,
    departed: false,
    committed: false,
    reloadRequested: false,
    failures: new Map(),
  };
  lifecycles.set(document, state);
  const view = document.defaultView;
  const resume = () => resumeRecovery(document, state);
  view?.addEventListener('beforeunload', () => {
    if (ownsDocument(document)) {
      state.tentativeDeparture = true;
    }
  });
  view?.addEventListener('pagehide', () => {
    if (!ownsDocument(document)) return;
    state.departed = true;
    state.tentativeDeparture = false;
    // Keep uncertain imports until a trusted interaction proves this document
    // survived the navigation (for example, because it became a download).
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
    if (state.departed && ownsDocument(document)) state.departed = false;
    // An input event can still occur while a slow navigation is in flight.
    // Keep uncertain imports pending long enough for pagehide to settle it.
    if (
      [...state.failures.values()].some(
        (failure) => failure.status === 'pending'
      )
    )
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
  // A provisional navigation can briefly replace WebKit's current document.
  // Keep import failures pending until the original document either returns or
  // is gone for good; application errors still require current ownership.
  if (
    (source !== 'module_import' && !ownsDocument(document)) ||
    !isCurrent() ||
    state.reloadRequested
  )
    return;
  if (state.failures.has(error)) return;
  const failure: PendingFailure = {
    error,
    isCurrent,
    status: 'pending',
    event:
      source === 'root' && state.committed
        ? 'client.root_uncaught'
        : 'client.hydration_failed',
  };
  state.failures.set(error, failure);
  // Import failures during departure may be canceled requests. Other failures
  // have reached application code and can be recorded even while leaving.
  if (source !== 'module_import') {
    reportFailure(document, failure);
    if (!state.tentativeDeparture && !state.departed)
      resumeRecovery(document, state);
  } else if (!state.tentativeDeparture && !state.departed) {
    setTimeout(() => resumeRecovery(document, state), IMPORT_FAILURE_SETTLE_MS);
  }
};

export const startClientHydration = async ({
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
  let module: HydrationModule;
  try {
    module = await loadHydrationModule();
  } catch (error) {
    handleClientHydrationFailure(document, error, isCurrent);
    return;
  }
  if (!isCurrent() || !isInitialHydrationDocumentActive(document)) return;
  try {
    await module.hydrateClient(document);
  } catch (error) {
    handleClientHydrationFailure(document, error, isCurrent, 'hydrate_start');
  }
};
