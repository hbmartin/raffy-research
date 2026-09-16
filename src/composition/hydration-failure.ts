export const reportHydrationFailure = (document: Document, error: unknown) => {
  const view = document.defaultView;
  if (view?.document !== document) return;
  const failure = error instanceof Error ? error : new Error(String(error));
  try {
    view.reportError?.(failure);
  } catch {
    // The visible recovery control still works when browser reporting fails.
  }
  const record = {
    records: [
      {
        level: 'error',
        event: 'client.hydration_failed',
        error: failure.message.slice(0, 256),
        timestamp: new Date().toISOString(),
      },
    ],
  };
  void fetch('/api/telemetry/logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
    credentials: 'same-origin',
    keepalive: true,
  }).catch(() => {});

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
