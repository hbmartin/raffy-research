import { join, map, pipe, unique } from 'remeda';
import { z } from 'zod';

import {
  isDevelopmentEnv,
  isProductionEnv,
  type RuntimeEnv,
} from '@/platform/env/merge-runtime-env';
import { readRuntimeEnv } from '@/platform/env/runtime-env';

import { ConfigurationError } from '../../domain/errors/configuration-error';

const isTruthy = (value: unknown) => value === true || value === 'true';

export const isProdRuntimeEnvironment = (source?: RuntimeEnv) =>
  isProductionEnv(source ?? readRuntimeEnv());

export const isDevRuntimeEnvironment = (source?: RuntimeEnv) =>
  isDevelopmentEnv(source ?? readRuntimeEnv());

export const shouldSkipEnvValidation = (source?: RuntimeEnv) => {
  const env = source ?? readRuntimeEnv();
  return isTruthy(env.SKIP_ENV_VALIDATION);
};

export const zNonEmptyEnvString = () => z.string().trim().min(1);

export const baseEnvSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    VERCEL_ENV: z.string().optional(),
  })
  .passthrough();

const fieldNameFromIssue = (issue: z.ZodIssue) =>
  issue.path.length ? issue.path.map(String).join('.') : 'environment';

export function parseEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  source?: Record<string, unknown>
): z.infer<TSchema> {
  const result = schema.safeParse(source ?? readRuntimeEnv());
  if (result.success) return result.data;

  const issues = pipe(
    result.error.issues,
    map((issue) => ({
      field: fieldNameFromIssue(issue),
      message: issue.message,
    }))
  );
  const fields = pipe(
    issues,
    map((issue) => issue.field),
    unique(),
    join(', ')
  );

  throw new ConfigurationError(`Invalid environment configuration: ${fields}`, {
    details: { issues },
    cause: result.error,
  });
}
