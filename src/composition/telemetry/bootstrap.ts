import { definePlugin } from 'nitro';

import { getTelemetryConfig } from '@/modules/kernel/infrastructure/config/telemetry';

// Validate eagerly, before Nitro accepts requests. Do not swallow configuration errors.
export default definePlugin(() => {
  getTelemetryConfig();
});
