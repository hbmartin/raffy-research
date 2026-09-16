import './platform/lib/zod/browser-config';

// Keep schema-bearing application chunks behind this boundary so their module
// initialization cannot run before the CSP-safe Zod configuration.
const initialDocument = document;
const isCurrentDocument = () =>
  initialDocument.defaultView?.document === initialDocument;

const reportHydrationFailure = (error: unknown) => {
  if (!isCurrentDocument()) return;
  const failure = error instanceof Error ? error : new Error(String(error));
  try {
    window.reportError?.(failure);
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

  if (initialDocument.getElementById('hydration-failure')) return;
  const notice = initialDocument.createElement('aside');
  notice.id = 'hydration-failure';
  notice.className = 'hydration-failure';
  notice.setAttribute('role', 'alert');
  const title = initialDocument.createElement('h2');
  title.textContent = 'This page could not finish loading';
  const explanation = initialDocument.createElement('p');
  explanation.textContent = 'Reload the page to try again.';
  const reload = initialDocument.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Reload page';
  reload.addEventListener('click', () =>
    initialDocument.defaultView?.location.reload()
  );
  notice.append(title, explanation, reload);
  initialDocument.body?.prepend(notice);
};

void import('./composition/hydrate-client')
  .then(({ hydrateClient }) =>
    isCurrentDocument() ? hydrateClient(initialDocument) : undefined
  )
  .catch(reportHydrationFailure);
