import { z } from 'zod';

import {
  baseEnvSchema,
  isProdRuntimeEnvironment,
  parseEnv,
} from './env-schema';

const loggerEnvSchema = baseEnvSchema.extend({
  LOGGER_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .optional(),
  LOGGER_PRETTY: z.stringbool().optional(),
});

export type LoggerConfig = {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  pretty: boolean;
};

let cachedLoggerConfig: LoggerConfig | undefined;

export function getLoggerConfig(
  source?: Record<string, unknown>
): LoggerConfig {
  if (!source && cachedLoggerConfig) return cachedLoggerConfig;

  const env = parseEnv(loggerEnvSchema, source);
  const isProd = isProdRuntimeEnvironment(env);
  const config: LoggerConfig = {
    level: env.LOGGER_LEVEL ?? (isProd ? 'error' : 'info'),
    pretty: env.LOGGER_PRETTY ?? !isProd,
  };
  if (!source) cachedLoggerConfig = config;
  return config;
}
