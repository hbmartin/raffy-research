import { getAuthConfig } from './auth';
import { getDatabaseConfig } from './database';
import { shouldSkipEnvValidation } from './env-schema';
import { getLoggerConfig } from './logger';
import { getRedisConfig } from './redis';
import { getTelemetryConfig } from './telemetry';

export function validateServerConfig() {
  if (shouldSkipEnvValidation()) return;

  getAuthConfig();
  getDatabaseConfig();
  getLoggerConfig();
  getRedisConfig();
  getTelemetryConfig();
}

validateServerConfig();
