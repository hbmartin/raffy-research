import { readRuntimeEnv } from '@/platform/env/runtime-env';

import { getAuthConfig, validateAuthBuildConfig } from './auth';
import { getDatabaseConfig } from './database';
import { shouldSkipEnvValidation } from './env-schema';
import { getLoggerConfig } from './logger';
import { getRedisConfig } from './redis';
import { getTelemetryConfig } from './telemetry';

export function validateServerConfig(phase: 'runtime' | 'build' = 'runtime') {
  const source = phase === 'build' ? readRuntimeEnv() : undefined;
  if (shouldSkipEnvValidation(source)) return;

  if (phase === 'build') validateAuthBuildConfig(source);
  else getAuthConfig();
  getDatabaseConfig(source);
  getLoggerConfig(source);
  getRedisConfig(source);
  getTelemetryConfig(source);
}

validateServerConfig(process.argv.includes('--build') ? 'build' : 'runtime');
