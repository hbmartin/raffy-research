import {
  reportHydrationFailure,
  reportRootFailure,
  showClientRecovery,
} from './hydration-failure';

type HydrationModule = {
  hydrateClient(document: Document): Promise<void>;
};
type FailureSource = 'module_import' | 'hydrate_start' | 'root';
type PendingFailure = {
  error: unknown;
  isCurrent: () => boolean;
  source: FailureSource;
  event: 'client.hydration_failed' | 'client.root_uncaught';
  status: 'pending' | 'reported' | 'scheduled' | 'shown';
};
type Lifecycle = {
  tentativeDeparture: boolean;
  hidden: boolean;
  blurred: boolean;
  departureVersion: number;
  importSettlementUntil: number;
  returnUntil: number;
  recoveryTimer?: ReturnType<typeof setTimeout>;
  recoveryNeeded: boolean;
  departed: boolean;
  committed: boolean;
  reloadRequested: boolean;
  failures: Map<unknown, PendingFailure>;
};
const lifecycles = new WeakMap<Document, Lifecycle>();
const coordinators = new WeakMap<Document, object>();
// Tab returns reconcile uncertain navigation after a bounded settling period.
const IMPORT_FAILURE_SETTLE_MS = 2_000;
const ownsDocument = (document: Document) =>
  document.defaultView?.document === document;
const monotonicNow = (document: Document) =>
  (document.defaultView?.performance ?? performance).now();

const cancelRecoveryTimer = (state: Lifecycle) => {
  clearTimeout(state.recoveryTimer);
  state.recoveryTimer = undefined;
};

const scheduleRecovery = (
  document: Document,
  state: Lifecycle,
  delay: number,
  showNotice = false
) => {
  cancelRecoveryTimer(state);
  state.recoveryTimer = setTimeout(
    () => {
      state.recoveryTimer = undefined;
      resumeRecovery(document, state, showNotice);
    },
    Math.max(0, delay)
  );
};

const reportFailure = (document: Document, failure: PendingFailure) => {
  if (failure.event === 'client.root_uncaught')
    reportRootFailure(document, failure.error, false);
  else reportHydrationFailure(document, failure.error, false);
  failure.status = 'reported';
};

const resumeRecovery = (
  document: Document,
  state: Lifecycle,
  showNotice = false
) => {
  if (
    !ownsDocument(document) ||
    state.reloadRequested ||
    document.visibilityState === 'hidden'
  )
    return;
  const now = monotonicNow(document);
  if (state.returnUntil > 0) {
    if (now < state.returnUntil) {
      scheduleRecovery(document, state, state.returnUntil - now);
      return;
    }
    state.returnUntil = 0;
    state.tentativeDeparture = false;
    state.departed = false;
  }
  if (state.departed || state.tentativeDeparture || !state.recoveryNeeded)
    return;
  let pending = false;
  let notice = false;
  for (const [error, failure] of state.failures) {
    if (!failure.isCurrent()) {
      state.failures.delete(error);
      continue;
    }
    if (failure.status === 'pending') {
      if (now < state.importSettlementUntil) {
        pending = true;
        continue;
      }
      reportFailure(document, failure);
    }
    if (failure.status === 'reported') {
      failure.status = 'scheduled';
      notice = true;
    } else if (failure.status === 'scheduled' && showNotice) {
      showClientRecovery(document, failure.event);
      failure.status = 'shown';
    } else if (failure.status === 'scheduled') notice = true;
  }
  state.recoveryNeeded = pending || notice;
  // Let the interaction and failure reporting finish before inserting a notice.
  if (notice) scheduleRecovery(document, state, 0, true);
  else if (pending)
    scheduleRecovery(document, state, state.importSettlementUntil - now);
};

const targetsDocument = (document: Document, target: string) => {
  const view = document.defaultView;
  const normalized = target.toLowerCase();
  return (
    target === '' ||
    normalized === '_self' ||
    normalized === '_parent' ||
    normalized === '_top' ||
    (target === view?.name && !normalized.startsWith('_'))
  );
};

const nativeDocumentActivation = (document: Document, event: Event) => {
  const target = event.target;
  const element =
    target && 'nodeType' in target && target.nodeType === 1
      ? (target as Element)
      : null;
  const baseTarget =
    document.querySelector?.('base[target]')?.getAttribute('target') ?? '';
  if (event.type === 'submit' && element?.matches('form')) {
    const form = element;
    const submitter = (event as SubmitEvent).submitter;
    const method = submitter?.getAttribute('formmethod') ?? form.method;
    const action = URL.parse(
      submitter?.getAttribute('formaction') ?? form.action,
      document.baseURI
    );
    return (
      method.toLowerCase() !== 'dialog' &&
      action !== null &&
      !/^(javascript|mailto|tel):$/.test(action.protocol) &&
      targetsDocument(
        document,
        submitter?.getAttribute('formtarget') ??
          form.getAttribute('target') ??
          baseTarget
      )
    );
  }
  if (event.type !== 'click') return false;
  const mouse = event as MouseEvent;
  if (
    mouse.button !== 0 ||
    mouse.metaKey ||
    mouse.ctrlKey ||
    mouse.shiftKey ||
    mouse.altKey
  )
    return false;
  const link = element?.closest('a[href], area[href]');
  if (
    !link ||
    link.hasAttribute('download') ||
    !targetsDocument(document, link.getAttribute('target') ?? baseTarget)
  )
    return false;
  const href = link.getAttribute('href') ?? '';
  const destination = URL.parse(href, document.baseURI);
  const current = URL.parse(document.URL);
  if (!destination || /^(javascript|mailto|tel):$/.test(destination.protocol))
    return false;
  return !(
    destination.href.includes('#') &&
    current &&
    destination.origin === current.origin &&
    destination.pathname === current.pathname &&
    destination.search === current.search
  );
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
    returnUntil: 0,
    recoveryNeeded: false,
    departed: false,
    committed: false,
    reloadRequested: false,
    failures: new Map(),
  };
  lifecycles.set(document, state);
  const view = document.defaultView;
  const resume = () => resumeRecovery(document, state);
  const returnToDocument = (reconcileDeparture = false) => {
    if (
      !ownsDocument(document) ||
      state.reloadRequested ||
      document.visibilityState === 'hidden'
    )
      return;
    const wasDeparting = state.tentativeDeparture || state.departed;
    if (reconcileDeparture) {
      if (state.returnUntil === 0)
        state.returnUntil = Math.max(
          state.importSettlementUntil,
          monotonicNow(document) + IMPORT_FAILURE_SETTLE_MS
        );
    } else if (state.returnUntil === 0) {
      state.tentativeDeparture = false;
      state.departed = false;
      state.returnUntil = 0;
      if (wasDeparting)
        state.importSettlementUntil = Math.max(
          state.importSettlementUntil,
          monotonicNow(document) + IMPORT_FAILURE_SETTLE_MS
        );
    }
    resume();
  };
  const markDeparture = () => {
    state.tentativeDeparture = true;
    state.departureVersion += 1;
    state.returnUntil = 0;
    cancelRecoveryTimer(state);
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
    state.returnUntil = 0;
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
    if (returning) returnToDocument(true);
  });
  document.addEventListener('visibilitychange', () => {
    const wasHidden = state.hidden;
    state.hidden = document.visibilityState === 'hidden';
    if (wasHidden && !state.hidden) returnToDocument(true);
  });
  const resumeOnInteraction = (event: Event) => {
    if (!event.isTrusted || !ownsDocument(document)) return;
    // The resulting click or submit determines whether an activation navigates.
    if (
      event.type === 'keydown' &&
      ['Enter', ' ', 'Spacebar'].includes((event as KeyboardEvent).key)
    )
      return;
    if (nativeDocumentActivation(document, event)) {
      const previous = {
        tentativeDeparture: state.tentativeDeparture,
        departed: state.departed,
        returnUntil: state.returnUntil,
      };
      // WebKit can delay beforeunload until the destination response arrives.
      markDeparture();
      const version = state.departureVersion;
      const coordinator = coordinators.get(document);
      setTimeout(() => {
        if (
          !ownsDocument(document) ||
          state.departureVersion !== version ||
          coordinators.get(document) !== coordinator
        )
          return;
        if (
          !event.defaultPrevented &&
          nativeDocumentActivation(document, event)
        )
          return;
        Object.assign(state, previous);
        resume();
      }, 0);
      return;
    }
    if (!state.recoveryNeeded && !state.tentativeDeparture && !state.departed)
      return;
    const departureVersion = state.departureVersion;
    const coordinator = coordinators.get(document);
    // Let the interaction and its default action finish before changing recovery.
    setTimeout(() => {
      if (
        state.departureVersion !== departureVersion ||
        coordinators.get(document) !== coordinator
      )
        return;
      returnToDocument();
    }, 0);
  };
  view?.addEventListener('click', resumeOnInteraction, { capture: true });
  view?.addEventListener('keydown', resumeOnInteraction, { capture: true });
  view?.addEventListener('submit', resumeOnInteraction, { capture: true });
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
  source: FailureSource = 'module_import'
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
  const existing = state.failures.get(error);
  if (existing) {
    if (
      source === 'root' &&
      existing.source !== 'root' &&
      existing.status === 'pending'
    ) {
      existing.source = source;
      existing.isCurrent = isCurrent;
      existing.event = state.committed
        ? 'client.root_uncaught'
        : 'client.hydration_failed';
      reportFailure(document, existing);
      resumeRecovery(document, state);
    }
    return;
  }
  const failure: PendingFailure = {
    error,
    isCurrent,
    source,
    status: 'pending',
    event:
      source === 'root' && state.committed
        ? 'client.root_uncaught'
        : 'client.hydration_failed',
  };
  state.failures.set(error, failure);
  state.recoveryNeeded = true;
  // Startup loading can be canceled during departure, including inside
  // hydrateStart. React root errors are actual failures even while leaving.
  if (
    source === 'root' ||
    (source === 'hydrate_start' && !state.tentativeDeparture && !state.departed)
  ) {
    reportFailure(document, failure);
  } else {
    state.importSettlementUntil = Math.max(
      state.importSettlementUntil,
      monotonicNow(document) + IMPORT_FAILURE_SETTLE_MS
    );
  }
  resumeRecovery(document, state);
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
