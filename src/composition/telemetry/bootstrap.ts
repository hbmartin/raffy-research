import { definePlugin } from 'nitro';

import { getAuthConfig } from '@/modules/kernel/infrastructure/config/auth';
import { getTelemetryConfig } from '@/modules/kernel/infrastructure/config/telemetry';

// Validate eagerly, before Nitro accepts requests. Do not swallow configuration errors.
export default definePlugin(() => {
  getTelemetryConfig();
  getAuthConfig();
});
