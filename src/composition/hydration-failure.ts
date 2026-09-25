import {
  flushFrontendLogs,
  frontendLogger,
} from '@/platform/telemetry/frontend-logger';

const reportClientFailure = (
  document: Document,
  error: unknown,
  event: 'client.hydration_failed' | 'client.root_uncaught',
  noticeTitle: string,
  showRecovery: boolean
) => {
  const view = document.defaultView;
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
  try {
    void flushFrontendLogs({ preferBeacon: false });
  } catch {
    // The recovery control still works when flushing fails.
  }

  if (!showRecovery || view?.document !== document) return;
  if (document.getElementById('hydration-failure')) return;
  const notice = document.createElement('aside');
  notice.id = 'hydration-failure';
  notice.className = 'hydration-failure';
  notice.setAttribute('role', 'alert');
  const title = document.createElement('h2');
  title.textContent = noticeTitle;
  const explanation = document.createElement('p');
  explanation.textContent = 'Reload the page to try again.';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Reload page';
  reload.addEventListener('click', () => view.location.reload());
  notice.append(title, explanation, reload);
  document.body?.prepend(notice);
};

export const reportHydrationFailure = (document: Document, error: unknown) => {
  if (document.defaultView?.document !== document) return;
  reportClientFailure(
    document,
    error,
    'client.hydration_failed',
    'This page could not finish loading',
    true
  );
};

export const reportRootFailure = (
  document: Document,
  error: unknown,
  showRecovery: boolean
) =>
  reportClientFailure(
    document,
    error,
    'client.root_uncaught',
    'This page encountered an error',
    showRecovery
  );
