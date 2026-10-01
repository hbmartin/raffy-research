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
  hidden: boolean;
  blurred: boolean;
  departureVersion: number;
  importSettlementUntil: number;
  departed: boolean;
  committed: boolean;
  reloadRequested: boolean;
  failures: Map<unknown, PendingFailure>;
};
const lifecycles = new WeakMap<Document, Lifecycle>();
const coordinators = new WeakMap<Document, object>();
// Settle active-document imports without treating elapsed time as navigation cancellation.
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
    state.tentativeDeparture ||
    state.reloadRequested ||
    document.visibilityState === 'hidden'
  )
    return;
  for (const [error, failure] of state.failures) {
    if (!failure.isCurrent()) {
      state.failures.delete(error);
      continue;
    }
    if (failure.status === 'pending') {
      if (Date.now() < state.importSettlementUntil) continue;
      reportFailure(document, failure);
    }
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
    hidden: document.visibilityState === 'hidden',
    blurred: false,
    departureVersion: 0,
    importSettlementUntil: 0,
    departed: false,
    committed: false,
    reloadRequested: false,
    failures: new Map(),
  };
  lifecycles.set(document, state);
  const view = document.defaultView;
  const resume = () => resumeRecovery(document, state);
  const returnToDocument = (settleImports = false) => {
    if (
      !ownsDocument(document) ||
      state.reloadRequested ||
      document.visibilityState === 'hidden'
    )
      return;
    state.tentativeDeparture = false;
    state.departed = false;
    state.importSettlementUntil = settleImports
      ? Date.now() + IMPORT_FAILURE_SETTLE_MS
      : 0;
    resume();
    if (settleImports) setTimeout(resume, IMPORT_FAILURE_SETTLE_MS);
  };
  const markDeparture = () => {
    state.tentativeDeparture = true;
    state.departureVersion += 1;
  };
  view?.addEventListener('beforeunload', () => {
    if (ownsDocument(document)) markDeparture();
  });
  view?.addEventListener('pagehide', () => {
    if (!ownsDocument(document)) return;
    markDeparture();
    state.departed = true;
    // Retain uncertain imports for a later interaction if this document survives.
  });
  view?.addEventListener('pageshow', (event) => {
    if (!ownsDocument(document) || !event.persisted) return;
    state.departed = false;
    state.tentativeDeparture = false;
    if (!state.committed && !state.reloadRequested) {
      state.reloadRequested = true;
      view.location.reload();
    } else resume();
  });
  view?.addEventListener('blur', () => {
    state.blurred = true;
  });
  view?.addEventListener('focus', () => {
    const returning = state.blurred;
    state.blurred = false;
    if (returning) returnToDocument();
  });
  document.addEventListener('visibilitychange', () => {
    const wasHidden = state.hidden;
    state.hidden = document.visibilityState === 'hidden';
    if (wasHidden && !state.hidden) returnToDocument();
  });
  const resumeOnInteraction = (event: Event) => {
    if (!event.isTrusted || !ownsDocument(document)) return;
    // Activation keys can start navigation before their corresponding keyup.
    const activationKey =
      event.type === 'keydown' &&
      ['Enter', ' ', 'Spacebar'].includes((event as KeyboardEvent).key);
    const target = event.target;
    const element =
      target && 'nodeType' in target && target.nodeType === 1
        ? (target as Element)
        : null;
    const activation = element?.closest('a[href], area[href], button, input');
    if (
      (event.type === 'click' || activationKey) &&
      activation?.matches('a[href], area[href]')
    ) {
      // WebKit can delay beforeunload until the destination response arrives.
      markDeparture();
      return;
    }
    if (
      (event.type === 'click' || activationKey) &&
      activation?.matches('button, input') &&
      (activation as HTMLButtonElement).type === 'submit' &&
      activation.closest('form')
    ) {
      markDeparture();
      return;
    }
    if (activationKey) {
      if ((event as KeyboardEvent).key === 'Enter' && element?.closest('form'))
        markDeparture();
      return;
    }
    const departureVersion = state.departureVersion;
    const coordinator = coordinators.get(document);
    // Let the interaction and its default action finish before changing recovery.
    setTimeout(() => {
      if (
        state.departureVersion !== departureVersion ||
        coordinators.get(document) !== coordinator
      )
        return;
      returnToDocument(true);
    }, 0);
  };
  view?.addEventListener('click', resumeOnInteraction, { capture: true });
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
