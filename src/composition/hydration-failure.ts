import {
  flushFrontendLogs,
  frontendLogger,
} from '@/platform/telemetry/frontend-logger';

export const reportHydrationFailure = (document: Document, error: unknown) => {
  const view = document.defaultView;
  if (view?.document !== document) return;
  const failure = error instanceof Error ? error : new Error(String(error));
  try {
    view.reportError?.(failure);
  } catch {
    // The visible recovery control still works when browser reporting fails.
  }
  try {
    frontendLogger.error('client.hydration_failed', {
      error: failure.message.slice(0, 256),
    });
    // The document is still active for genuine hydration failures. Prefer a
    // directly observable fetch here; lifecycle flushes continue using beacon.
    void flushFrontendLogs({ preferBeacon: false });
  } catch {
    // The visible recovery control still works when logging fails.
  }

  if (document.getElementById('hydration-failure')) return;
  const notice = document.createElement('aside');
  notice.id = 'hydration-failure';
  notice.className = 'hydration-failure';
  notice.setAttribute('role', 'alert');
  const title = document.createElement('h2');
  title.textContent = 'This page could not finish loading';
  const explanation = document.createElement('p');
  explanation.textContent = 'Reload the page to try again.';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Reload page';
  reload.addEventListener('click', () => view.location.reload());
  notice.append(title, explanation, reload);
  document.body?.prepend(notice);
};
