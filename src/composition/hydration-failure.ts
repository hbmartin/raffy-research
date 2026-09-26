import {
  flushFrontendLogs,
  frontendLogger,
} from '@/platform/telemetry/frontend-logger';

const reportClientFailure = (
  document: Document,
  error: unknown,
  event: 'client.hydration_failed' | 'client.root_uncaught',
  showRecovery: boolean
) => {
  const view = document.defaultView;
  if (view?.document !== document) return;
  const failure = error instanceof Error ? error : new Error(String(error));
  try {
    view?.reportError?.(failure);
  } catch {
    // The recovery control and frontend logger still run if browser reporting fails.
  }
  try {
    frontendLogger.error(event, {
      error: failure.message.slice(0, 256),
    });
  } catch {
    // Attempt to flush any previously queued logs even if logging failed.
  }
  void flushFrontendLogs({ preferBeacon: !showRecovery }).catch(() => {
    // The recovery control still works when flushing fails.
  });

  if (showRecovery) showClientRecovery(document, event);
};

export const showClientRecovery = (
  document: Document,
  event: 'client.hydration_failed' | 'client.root_uncaught'
) => {
  const view = document.defaultView;
  if (view?.document !== document) return;
  if (document.getElementById('hydration-failure')) return;
  const notice = document.createElement('aside');
  notice.id = 'hydration-failure';
  notice.className = 'hydration-failure';
  notice.setAttribute('role', 'alert');
  const title = document.createElement('h2');
  title.textContent =
    event === 'client.hydration_failed'
      ? 'This page could not finish loading'
      : 'This page encountered an error';
  const explanation = document.createElement('p');
  explanation.textContent = 'Reload the page to try again.';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Reload page';
  reload.addEventListener('click', () => view.location.reload());
  notice.append(title, explanation, reload);
  document.body?.prepend(notice);
};

export const reportHydrationFailure = (
  document: Document,
  error: unknown,
  showRecovery = true
) => {
  reportClientFailure(document, error, 'client.hydration_failed', showRecovery);
};

export const reportRootFailure = (
  document: Document,
  error: unknown,
  showRecovery: boolean
) => reportClientFailure(document, error, 'client.root_uncaught', showRecovery);
