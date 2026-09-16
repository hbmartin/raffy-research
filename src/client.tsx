import './platform/lib/zod/browser-config';

import { startClientHydration } from './composition/start-client-hydration';

// Keep schema-bearing application chunks behind this boundary so their module
// initialization cannot run before the CSP-safe Zod configuration.
void startClientHydration({
  document,
  loadHydrationModule: () => import('./composition/hydrate-client'),
});
