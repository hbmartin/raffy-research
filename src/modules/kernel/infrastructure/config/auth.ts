import { validateHeaderName } from 'node:http';
import { filter, isTruthy, map, pipe } from 'remeda';
import { z } from 'zod';

import {
  baseEnvSchema,
  isProdRuntimeEnvironment,
  parseEnv,
  shouldSkipEnvValidation,
} from './env-schema';
import { ConfigurationError } from '../../domain/errors/configuration-error';

const zOptionalProviderSecret = () => z.string().optional();
const AUTH_SECRET_MIN_LENGTH = 32;
const AUTH_SECRET_PLACEHOLDERS = new Set([
  'changeme',
  'change-me',
  'change_me',
  'password',
  'replace me',
  'secret',
  'test-auth-key',
]);

const splitCsv = (value?: string) =>
  value === undefined
    ? undefined
    : pipe(
        value.split(','),
        map((item) => item.trim()),
        filter(isTruthy)
      );

const isPlaceholderAuthSecret = (value: string) =>
  AUTH_SECRET_PLACEHOLDERS.has(value.trim().toLowerCase());

const authProviderEnvSchema = baseEnvSchema.extend({
  AUTH_PROVIDER: z.enum(['better-auth', 'workos']).prefault('better-auth'),
});

const ssrFixtureMarkerEnvSchema = baseEnvSchema.extend({
  SSR_FIXTURE_MODE: z.enum(['true', 'false']).optional(),
  HOST: z.string().optional(),
  NITRO_HOST: z.string().optional(),
  VITE_BASE_URL: z.string().optional(),
});

const betterAuthEnvSchema = baseEnvSchema
  .extend({
    AUTH_SECRET: z.string().trim(),
    AUTH_SESSION_EXPIRATION_IN_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .prefault(2_592_000),
    AUTH_SESSION_UPDATE_AGE_IN_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .prefault(86_400),
    AUTH_ALLOWED_HOSTS: z.string().optional(),
    AUTH_TRUSTED_ORIGINS: z.string().optional(),
    AUTH_TRUSTED_CLIENT_IP_HEADER: z.string().trim().optional(),
    VERCEL: z.string().optional(),
    VERCEL_REGION: z.string().trim().optional(),
    SSR_FIXTURE_MODE: z.enum(['true', 'false']).optional(),
    HOST: z.string().optional(),
    VITE_BASE_URL: z.string().optional(),
    GITHUB_CLIENT_ID: zOptionalProviderSecret(),
    GITHUB_CLIENT_SECRET: zOptionalProviderSecret(),
  })
  .superRefine((env, ctx) => {
    if (!shouldSkipEnvValidation(env)) {
      if (env.AUTH_SECRET.length < AUTH_SECRET_MIN_LENGTH) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_SECRET'],
          message: `AUTH_SECRET must be at least ${AUTH_SECRET_MIN_LENGTH} characters`,
        });
      }

      if (isPlaceholderAuthSecret(env.AUTH_SECRET)) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_SECRET'],
          message: 'AUTH_SECRET must not use a placeholder value',
        });
      }
    }

    if (!isProdRuntimeEnvironment(env)) return;

    const fixtureMode = env.SSR_FIXTURE_MODE === 'true';
    const isVercelRuntime = env.VERCEL === '1' && Boolean(env.VERCEL_REGION);
    const fixtureIsLoopback =
      env.HOST === '127.0.0.1' &&
      (() => {
        try {
          return new URL(env.VITE_BASE_URL ?? '').hostname === '127.0.0.1';
        } catch {
          return false;
        }
      })();
    if (fixtureMode && !fixtureIsLoopback) {
      ctx.addIssue({
        code: 'custom',
        path: ['SSR_FIXTURE_MODE'],
        message: 'SSR fixture mode requires a loopback host and base URL',
      });
    }
    if (
      !shouldSkipEnvValidation(env) &&
      !isVercelRuntime &&
      !fixtureMode &&
      !env.AUTH_TRUSTED_CLIENT_IP_HEADER
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_TRUSTED_CLIENT_IP_HEADER'],
        message:
          'A proxy-owned client IP header is required for self-hosted production',
      });
    }
    if (env.AUTH_TRUSTED_CLIENT_IP_HEADER) {
      try {
        validateHeaderName(env.AUTH_TRUSTED_CLIENT_IP_HEADER);
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_TRUSTED_CLIENT_IP_HEADER'],
          message: 'Use a valid proxy-owned client IP header',
        });
      }
      if (
        env.AUTH_TRUSTED_CLIENT_IP_HEADER.toLowerCase() === 'x-forwarded-for'
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_TRUSTED_CLIENT_IP_HEADER'],
          message: 'Use a dedicated proxy-owned header, not X-Forwarded-For',
        });
      }
    }

    for (const field of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'] as const) {
      if (env[field] === 'REPLACE ME') {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'Update the value "REPLACE ME" or remove the variable',
        });
      }
    }
  })
  .transform((env) => ({
    ...env,
    GITHUB_CLIENT_ID:
      env.GITHUB_CLIENT_ID === 'REPLACE ME' ? undefined : env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET:
      env.GITHUB_CLIENT_SECRET === 'REPLACE ME'
        ? undefined
        : env.GITHUB_CLIENT_SECRET,
  }));

export type AuthProvider = 'better-auth' | 'workos';

export type AuthProviderConfig = {
  provider: AuthProvider;
};

export type BetterAuthConfig = {
  secret: string;
  sessionExpirationInSeconds: number;
  sessionUpdateAgeInSeconds: number;
  allowedHosts?: string[];
  trustedOrigins?: string[];
  trustedClientIpHeader?: string;
  fixtureSignInRateLimit: boolean;
  githubClientId?: string;
  githubClientSecret?: string;
};

export type AuthConfig = BetterAuthConfig;

let cachedAuthProviderConfig: AuthProviderConfig | undefined;
let cachedBetterAuthConfig: BetterAuthConfig | undefined;
let reportedSharedRateLimitBucket = false;

const reportSharedRateLimitBucket = () => {
  if (reportedSharedRateLimitBucket) return;
  reportedSharedRateLimitBucket = true;
  process.stderr.write(
    '{"event":"auth.rate_limit_shared_bucket","reason":"trusted_client_ip_unconfigured"}\n'
  );
};

export function getAuthProviderConfig(): AuthProviderConfig {
  if (cachedAuthProviderConfig) return cachedAuthProviderConfig;

  const env = parseEnv(authProviderEnvSchema);
  cachedAuthProviderConfig = {
    provider: env.AUTH_PROVIDER,
  };
  return cachedAuthProviderConfig;
}

export function getBetterAuthConfig(): BetterAuthConfig {
  if (cachedBetterAuthConfig) return cachedBetterAuthConfig;

  const env = parseEnv(betterAuthEnvSchema);
  const isVercelRuntime = env.VERCEL === '1' && Boolean(env.VERCEL_REGION);
  const trustedClientIpHeader =
    env.AUTH_TRUSTED_CLIENT_IP_HEADER ??
    (isVercelRuntime ? 'x-vercel-forwarded-for' : undefined);
  const fixtureSignInRateLimit = env.SSR_FIXTURE_MODE === 'true';
  if (
    isProdRuntimeEnvironment(env) &&
    shouldSkipEnvValidation(env) &&
    !fixtureSignInRateLimit &&
    !trustedClientIpHeader
  ) {
    reportSharedRateLimitBucket();
  }

  cachedBetterAuthConfig = {
    secret: env.AUTH_SECRET,
    sessionExpirationInSeconds: env.AUTH_SESSION_EXPIRATION_IN_SECONDS,
    sessionUpdateAgeInSeconds: env.AUTH_SESSION_UPDATE_AGE_IN_SECONDS,
    allowedHosts: splitCsv(env.AUTH_ALLOWED_HOSTS),
    trustedOrigins: splitCsv(env.AUTH_TRUSTED_ORIGINS),
    trustedClientIpHeader,
    fixtureSignInRateLimit,
    githubClientId: env.GITHUB_CLIENT_ID,
    githubClientSecret: env.GITHUB_CLIENT_SECRET,
  };
  return cachedBetterAuthConfig;
}

export function getAuthConfig(): AuthConfig {
  const { provider } = getAuthProviderConfig();
  if (provider !== 'better-auth') {
    throw new ConfigurationError(
      `AUTH_PROVIDER=${provider} is not implemented in this build.`
    );
  }
  return getBetterAuthConfig();
}

export function isValidatedSsrFixtureRuntime(isProductionBuild: boolean) {
  const env = parseEnv(ssrFixtureMarkerEnvSchema);
  if (env.SSR_FIXTURE_MODE !== 'true') return false;

  let baseUrlIsLoopback = false;
  try {
    const baseUrl = new URL(env.VITE_BASE_URL ?? '');
    baseUrlIsLoopback =
      baseUrl.protocol === 'http:' &&
      baseUrl.hostname === '127.0.0.1' &&
      !baseUrl.username &&
      !baseUrl.password;
  } catch {
    // An invalid fixture URL is rejected below.
  }
  if (
    !isProductionBuild ||
    env.NODE_ENV !== 'production' ||
    env.HOST !== '127.0.0.1' ||
    (env.NITRO_HOST !== undefined && env.NITRO_HOST !== '127.0.0.1') ||
    shouldSkipEnvValidation(env) ||
    !baseUrlIsLoopback
  ) {
    throw new ConfigurationError(
      'SSR fixture mode requires a production build and loopback host and base URL.'
    );
  }

  getAuthConfig();
  return true;
}
