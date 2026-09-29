import { makeTestDatabaseUrl } from '@tests/server/test-database-url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeRuntimeEnv } from '@/platform/env/merge-runtime-env';

const environment = vi.hoisted(() => ({
  build: {} as Record<string, unknown>,
}));
vi.mock('@/platform/env/runtime-env', async () => {
  const { mergeRuntimeEnv } = await import('@/platform/env/merge-runtime-env');
  return {
    readRuntimeEnv: () => mergeRuntimeEnv(process.env, environment.build),
  };
});

describe('server config accessors', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    environment.build = {};
    vi.stubEnv('SKIP_ENV_VALIDATION', undefined);
    vi.stubEnv('VERCEL', undefined);
    vi.stubEnv('VERCEL_REGION', undefined);
    vi.stubEnv('SSR_FIXTURE_MODE', undefined);
    vi.stubEnv('AUTH_TRUSTED_CLIENT_IP_HEADER', undefined);
  });

  it('caches parsed database config', async () => {
    const firstDatabaseUrl = makeTestDatabaseUrl({
      credentialLabel: 'first',
      databaseName: 'first',
    });
    const secondDatabaseUrl = makeTestDatabaseUrl({
      credentialLabel: 'second',
      databaseName: 'second',
    });

    vi.stubEnv('DATABASE_URL', firstDatabaseUrl);
    const { getDatabaseConfig } =
      await import('@/modules/kernel/infrastructure/config/database');

    const first = getDatabaseConfig();
    vi.stubEnv('DATABASE_URL', secondDatabaseUrl);

    expect(getDatabaseConfig()).toBe(first);
    expect(getDatabaseConfig().databaseUrl).toBe(firstDatabaseUrl);
    expect(getDatabaseConfig().driver).toBe('node-pg');
  });

  it('parses explicit database driver config', async () => {
    const databaseUrl = makeTestDatabaseUrl();

    vi.stubEnv('DATABASE_URL', databaseUrl);
    vi.stubEnv('DATABASE_DRIVER', 'neon-http');
    const { getDatabaseConfig } =
      await import('@/modules/kernel/infrastructure/config/database');

    expect(getDatabaseConfig()).toEqual({
      databaseUrl,
      driver: 'neon-http',
    });
  });

  it('defaults migration config to node-pg for node-pg runtime drivers', async () => {
    const databaseUrl = makeTestDatabaseUrl();

    vi.stubEnv('DATABASE_URL', databaseUrl);
    vi.stubEnv('DATABASE_DRIVER', 'node-pg');
    const { getMigrationDatabaseConfig } =
      await import('@/modules/kernel/infrastructure/config/database');

    expect(getMigrationDatabaseConfig()).toEqual({
      databaseUrl,
      driver: 'node-pg',
    });
  });

  it.each(['neon-http', 'neon-websocket'] as const)(
    'defaults migration config to Neon WebSocket for %s runtime drivers',
    async (driver) => {
      const databaseUrl = makeTestDatabaseUrl();

      vi.stubEnv('DATABASE_URL', databaseUrl);
      vi.stubEnv('DATABASE_DRIVER', driver);
      const { getMigrationDatabaseConfig } =
        await import('@/modules/kernel/infrastructure/config/database');

      expect(getMigrationDatabaseConfig()).toEqual({
        databaseUrl,
        driver: 'neon-websocket',
      });
    }
  );

  it('uses explicit migration URL and driver config', async () => {
    const runtimeDatabaseUrl = makeTestDatabaseUrl({
      credentialLabel: 'runtime',
    });
    const migrationDatabaseUrl = makeTestDatabaseUrl({
      credentialLabel: 'migration',
    });

    vi.stubEnv('DATABASE_URL', runtimeDatabaseUrl);
    vi.stubEnv('DATABASE_DRIVER', 'neon-http');
    vi.stubEnv('DATABASE_MIGRATION_URL', migrationDatabaseUrl);
    vi.stubEnv('DATABASE_MIGRATION_DRIVER', 'node-pg');
    const { getMigrationDatabaseConfig } =
      await import('@/modules/kernel/infrastructure/config/database');

    expect(getMigrationDatabaseConfig()).toEqual({
      databaseUrl: migrationDatabaseUrl,
      driver: 'node-pg',
    });
  });

  it('requires explicit migration URL when requested by evidence migration command', async () => {
    vi.stubEnv('DATABASE_URL', makeTestDatabaseUrl());
    vi.stubEnv('DATABASE_DRIVER', 'neon-http');
    vi.stubEnv('DATABASE_MIGRATION_REQUIRE_URL', 'true');
    const { getMigrationDatabaseConfig } =
      await import('@/modules/kernel/infrastructure/config/database');
    const { ConfigurationError } =
      await import('@/modules/kernel/domain/errors/configuration-error');

    expect(() => getMigrationDatabaseConfig()).toThrow(ConfigurationError);
  });

  it('rejects Neon HTTP as a migration driver', async () => {
    vi.stubEnv('DATABASE_URL', makeTestDatabaseUrl());
    vi.stubEnv('DATABASE_MIGRATION_DRIVER', 'neon-http');
    const { getMigrationDatabaseConfig } =
      await import('@/modules/kernel/infrastructure/config/database');
    const { ConfigurationError } =
      await import('@/modules/kernel/domain/errors/configuration-error');

    expect(() => getMigrationDatabaseConfig()).toThrow(ConfigurationError);
  });

  it('rejects likely transaction-pooled migration URLs', async () => {
    vi.stubEnv('DATABASE_URL', makeTestDatabaseUrl());
    vi.stubEnv(
      'DATABASE_MIGRATION_URL',
      makeTestDatabaseUrl({
        host: 'ep-example-pooler.us-east-1.aws.neon.tech',
        port: null,
      })
    );
    const { getMigrationDatabaseConfig } =
      await import('@/modules/kernel/infrastructure/config/database');
    const { ConfigurationError } =
      await import('@/modules/kernel/domain/errors/configuration-error');

    expect(() => getMigrationDatabaseConfig()).toThrow(ConfigurationError);
  });

  it('detects likely transaction-pooled database URLs', async () => {
    const { isLikelyTransactionPooledDatabaseUrl } =
      await import('@/modules/kernel/infrastructure/config/database');

    expect(
      isLikelyTransactionPooledDatabaseUrl(
        makeTestDatabaseUrl({
          databaseName: 'db',
          host: 'ep-example-pooler.us-east-1.aws.neon.tech',
          port: null,
        })
      )
    ).toBe(true);
    expect(
      isLikelyTransactionPooledDatabaseUrl(
        makeTestDatabaseUrl({
          databaseName: 'db',
          searchParams: { pool_mode: 'transaction' },
        })
      )
    ).toBe(true);
    expect(
      isLikelyTransactionPooledDatabaseUrl(
        makeTestDatabaseUrl({ databaseName: 'db' })
      )
    ).toBe(false);
  });

  it('defaults the auth provider to Better Auth', async () => {
    vi.stubEnv('AUTH_PROVIDER', undefined);
    const { getAuthProviderConfig } =
      await import('@/modules/kernel/infrastructure/config/auth');

    expect(getAuthProviderConfig()).toEqual({ provider: 'better-auth' });
  });

  it('parses WorkOS as a reserved auth provider without Better Auth secrets', async () => {
    vi.stubEnv('AUTH_PROVIDER', 'workos');
    vi.stubEnv('AUTH_SECRET', undefined);
    const { getAuthProviderConfig } =
      await import('@/modules/kernel/infrastructure/config/auth');

    expect(getAuthProviderConfig()).toEqual({ provider: 'workos' });
  });

  it('rejects reserved auth providers through the Better Auth config accessor', async () => {
    vi.stubEnv('AUTH_PROVIDER', 'workos');
    vi.stubEnv('AUTH_SECRET', undefined);
    const { getAuthConfig } =
      await import('@/modules/kernel/infrastructure/config/auth');
    const { ConfigurationError } =
      await import('@/modules/kernel/domain/errors/configuration-error');

    expect(() => getAuthConfig()).toThrow(ConfigurationError);
  });

  it('rejects short AUTH_SECRET values without exposing the value', async () => {
    expect.assertions(3);
    const weakAuthValue = ['too', 'short', 'fixture'].join('-');
    vi.stubEnv('AUTH_PROVIDER', 'better-auth');
    vi.stubEnv('AUTH_SECRET', weakAuthValue);
    const { getBetterAuthConfig } =
      await import('@/modules/kernel/infrastructure/config/auth');
    const { ConfigurationError } =
      await import('@/modules/kernel/domain/errors/configuration-error');

    let error: unknown;
    try {
      getBetterAuthConfig();
    } catch (caughtError) {
      error = caughtError;
    }

    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as Error).message).toContain('AUTH_SECRET');
    expect((error as Error).message).not.toContain(weakAuthValue);
  });

  it('rejects placeholder AUTH_SECRET values', async () => {
    vi.stubEnv('AUTH_PROVIDER', 'better-auth');
    vi.stubEnv('AUTH_SECRET', 'replace me');
    const { getBetterAuthConfig } =
      await import('@/modules/kernel/infrastructure/config/auth');
    const { ConfigurationError } =
      await import('@/modules/kernel/domain/errors/configuration-error');

    expect(() => getBetterAuthConfig()).toThrow(ConfigurationError);
  });

  it('accepts strong AUTH_SECRET values', async () => {
    vi.stubEnv('AUTH_PROVIDER', 'better-auth');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
    const { getBetterAuthConfig } =
      await import('@/modules/kernel/infrastructure/config/auth');

    expect(getBetterAuthConfig().secret).toBe('a'.repeat(32));
  });

  it('requires a dedicated proxy IP header for self-hosted production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', undefined);
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('VERCEL_REGION', undefined);
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
    const { getBetterAuthConfig } =
      await import('@/modules/kernel/infrastructure/config/auth');
    expect(getBetterAuthConfig).toThrow('AUTH_TRUSTED_CLIENT_IP_HEADER');
  });

  it('does not trust a stale VERCEL_ENV marker', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
    vi.stubEnv('VERCEL_ENV', 'production');
    const { getBetterAuthConfig } =
      await import('@/modules/kernel/infrastructure/config/auth');

    expect(getBetterAuthConfig).toThrow('AUTH_TRUSTED_CLIENT_IP_HEADER');
  });

  it('validates Vercel builds without trusting or caching their runtime IP header', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_REGION', undefined);
    const { getBetterAuthConfig, validateAuthBuildConfig } =
      await import('@/modules/kernel/infrastructure/config/auth');

    expect(validateAuthBuildConfig).not.toThrow();
    expect(getBetterAuthConfig).toThrow('AUTH_TRUSTED_CLIENT_IP_HEADER');
    vi.stubEnv('VERCEL_REGION', 'sfo1');
    expect(getBetterAuthConfig().trustedClientIpHeader).toBe(
      'x-vercel-forwarded-for'
    );
    vi.stubEnv('AUTH_SECRET', 'too-short');
    expect(validateAuthBuildConfig).toThrow('AUTH_SECRET');
  });

  it.each(['', '   '])(
    'does not trust an empty runtime region: %j',
    async (region) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
      vi.stubEnv('VERCEL', '1');
      vi.stubEnv('VERCEL_REGION', region);
      const { getBetterAuthConfig } =
        await import('@/modules/kernel/infrastructure/config/auth');
      expect(getBetterAuthConfig).toThrow('AUTH_TRUSTED_CLIENT_IP_HEADER');
    }
  );

  it.each([undefined, 'development'])(
    'retains built production validation with runtime NODE_ENV=%s',
    async (nodeEnv) => {
      environment.build = { PROD: true, DEV: false };
      vi.stubEnv('NODE_ENV', nodeEnv);
      vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
      vi.stubEnv('OTEL_COLLECTOR_URL', undefined);
      const { getBetterAuthConfig } =
        await import('@/modules/kernel/infrastructure/config/auth');
      const { getTelemetryConfig } =
        await import('@/modules/kernel/infrastructure/config/telemetry');
      expect(getBetterAuthConfig).toThrow('AUTH_TRUSTED_CLIENT_IP_HEADER');
      expect(getTelemetryConfig).toThrow('OTEL_COLLECTOR_URL');
    }
  );

  it('does not infer Vercel from a region without its deployment marker', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
    vi.stubEnv('VERCEL', undefined);
    vi.stubEnv('VERCEL_REGION', 'sfo1');
    const { getBetterAuthConfig } =
      await import('@/modules/kernel/infrastructure/config/auth');

    expect(getBetterAuthConfig).toThrow('AUTH_TRUSTED_CLIENT_IP_HEADER');
  });

  it('gives an explicit trusted header precedence over Vercel detection', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_REGION', 'sfo1');
    vi.stubEnv('AUTH_TRUSTED_CLIENT_IP_HEADER', 'x-proxy-client-ip');
    const { getBetterAuthConfig } =
      await import('@/modules/kernel/infrastructure/config/auth');

    expect(getBetterAuthConfig().trustedClientIpHeader).toBe(
      'x-proxy-client-ip'
    );
  });

  it('diagnoses the accepted shared bucket once under the validation bypass', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
    vi.stubEnv('SKIP_ENV_VALIDATION', 'true');
    vi.stubEnv('VERCEL', undefined);
    vi.stubEnv('VERCEL_REGION', undefined);
    vi.stubEnv('AUTH_TRUSTED_CLIENT_IP_HEADER', undefined);
    const diagnostic = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const { getBetterAuthConfig } =
      await import('@/modules/kernel/infrastructure/config/auth');

    expect(getBetterAuthConfig().trustedClientIpHeader).toBeUndefined();
    getBetterAuthConfig();
    expect(diagnostic).toHaveBeenCalledOnce();
    expect(diagnostic.mock.calls[0]?.[0]).toBe(
      '{"event":"auth.rate_limit_shared_bucket","reason":"trusted_client_ip_unconfigured"}\n'
    );
  });

  it('rejects X-Forwarded-For as the self-hosted trusted header', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
    vi.stubEnv('AUTH_TRUSTED_CLIENT_IP_HEADER', 'X-Forwarded-For');
    const { getBetterAuthConfig } =
      await import('@/modules/kernel/infrastructure/config/auth');
    expect(getBetterAuthConfig).toThrow('AUTH_TRUSTED_CLIENT_IP_HEADER');
  });

  it('limits SSR sign-in relaxation to the loopback fixture', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
    vi.stubEnv('SSR_FIXTURE_MODE', 'true');
    vi.stubEnv('HOST', '127.0.0.1');
    vi.stubEnv('VITE_BASE_URL', 'http://127.0.0.1:3011');
    const { getBetterAuthConfig } =
      await import('@/modules/kernel/infrastructure/config/auth');
    expect(
      getBetterAuthConfig(mergeRuntimeEnv(process.env, environment.build))
        .fixtureSignInRateLimit
    ).toBe(true);
    vi.resetModules();
    vi.stubEnv('HOST', '0.0.0.0');
    const { getBetterAuthConfig: getPublicConfig } =
      await import('@/modules/kernel/infrastructure/config/auth');
    expect(() =>
      getPublicConfig(mergeRuntimeEnv(process.env, environment.build))
    ).toThrow('SSR_FIXTURE_MODE');
  });

  it('validates the fixture build, runtime, loopback, and auth config', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SSR_FIXTURE_MODE', 'true');
    vi.stubEnv('HOST', '127.0.0.1');
    vi.stubEnv('VITE_BASE_URL', 'http://127.0.0.1:3011');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
    const { isValidatedSsrFixtureRuntime } =
      await import('@/modules/kernel/infrastructure/config/auth');

    expect(
      isValidatedSsrFixtureRuntime(
        true,
        mergeRuntimeEnv(process.env, environment.build)
      )
    ).toBe(true);
    expect(() =>
      isValidatedSsrFixtureRuntime(
        false,
        mergeRuntimeEnv(process.env, environment.build)
      )
    ).toThrow('production build');
  });

  it('rejects a runtime loopback URL when the built VITE URL differs', async () => {
    environment.build = {
      VITE_BASE_URL: 'https://built.example',
      PROD: true,
      DEV: false,
    };
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SSR_FIXTURE_MODE', 'true');
    vi.stubEnv('HOST', '127.0.0.1');
    vi.stubEnv('VITE_BASE_URL', 'http://127.0.0.1:3011');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
    const { isValidatedSsrFixtureRuntime } =
      await import('@/modules/kernel/infrastructure/config/auth');

    expect(() => isValidatedSsrFixtureRuntime(true)).toThrow(
      'SSR fixture mode'
    );
  });

  it.each([
    ['NODE_ENV', 'development'],
    ['HOST', '0.0.0.0'],
    ['NITRO_HOST', '0.0.0.0'],
    ['SKIP_ENV_VALIDATION', 'true'],
    ['VITE_BASE_URL', 'https://example.test'],
    ['VITE_BASE_URL', 'http://user@127.0.0.1:3011'],
  ])('rejects an invalid fixture %s', async (key, value) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SSR_FIXTURE_MODE', 'true');
    vi.stubEnv('HOST', '127.0.0.1');
    vi.stubEnv('VITE_BASE_URL', 'http://127.0.0.1:3011');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
    vi.stubEnv(key, value);
    const { isValidatedSsrFixtureRuntime } =
      await import('@/modules/kernel/infrastructure/config/auth');

    expect(() =>
      isValidatedSsrFixtureRuntime(
        true,
        mergeRuntimeEnv(process.env, environment.build)
      )
    ).toThrow('SSR fixture mode');
  });

  it('rejects invalid auth configuration for the fixture', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SSR_FIXTURE_MODE', 'true');
    vi.stubEnv('HOST', '127.0.0.1');
    vi.stubEnv('VITE_BASE_URL', 'http://127.0.0.1:3011');
    vi.stubEnv('AUTH_SECRET', 'too-short');
    const { isValidatedSsrFixtureRuntime } =
      await import('@/modules/kernel/infrastructure/config/auth');

    expect(() =>
      isValidatedSsrFixtureRuntime(
        true,
        mergeRuntimeEnv(process.env, environment.build)
      )
    ).toThrow('AUTH_SECRET');
  });

  it('allows weak AUTH_SECRET values only when env validation is skipped', async () => {
    const weakAuthValue = ['too', 'short', 'fixture'].join('-');
    vi.stubEnv('AUTH_PROVIDER', 'better-auth');
    vi.stubEnv('AUTH_SECRET', weakAuthValue);
    vi.stubEnv('SKIP_ENV_VALIDATION', 'true');
    const { getBetterAuthConfig } =
      await import('@/modules/kernel/infrastructure/config/auth');

    expect(getBetterAuthConfig().secret).toBe(weakAuthValue);
  });

  it('skips server config validation when SKIP_ENV_VALIDATION is true', async () => {
    vi.stubEnv('SKIP_ENV_VALIDATION', 'true');
    vi.stubEnv('AUTH_SECRET', undefined);
    vi.stubEnv('DATABASE_URL', undefined);

    await expect(
      import('@/modules/kernel/infrastructure/config/server')
    ).resolves.toHaveProperty('validateServerConfig');
  });

  it('returns null for absent optional Redis config', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', undefined);
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', undefined);
    const { getRedisConfig } =
      await import('@/modules/kernel/infrastructure/config/redis');

    expect(getRedisConfig()).toBeNull();
  });

  it('returns null for partial optional Redis config', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', undefined);
    const { getRedisConfig } =
      await import('@/modules/kernel/infrastructure/config/redis');

    expect(getRedisConfig()).toBeNull();
  });

  it('returns Redis config when both required values are present', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'valid-token-value');
    const { getRedisConfig } =
      await import('@/modules/kernel/infrastructure/config/redis');

    expect(getRedisConfig()).toEqual({
      restUrl: 'https://redis.example.com',
      restToken: 'valid-token-value',
    });
  });

  it('throws ConfigurationError for malformed Redis config', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'not-a-url');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token-value');
    const { getRedisConfig } =
      await import('@/modules/kernel/infrastructure/config/redis');
    const { ConfigurationError } =
      await import('@/modules/kernel/domain/errors/configuration-error');

    expect(() => getRedisConfig()).toThrow(ConfigurationError);
  });

  it('requires an OpenTelemetry Collector URL in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('OTEL_COLLECTOR_URL', undefined);
    const { getTelemetryConfig } =
      await import('@/modules/kernel/infrastructure/config/telemetry');
    const { ConfigurationError } =
      await import('@/modules/kernel/domain/errors/configuration-error');

    expect(() => getTelemetryConfig()).toThrow(ConfigurationError);
    expect(() => getTelemetryConfig()).toThrow('OTEL_COLLECTOR_URL');
  });

  it('accepts production telemetry config when the Collector URL is present', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('OTEL_COLLECTOR_URL', 'https://collector.example/v1');
    const { getTelemetryConfig } =
      await import('@/modules/kernel/infrastructure/config/telemetry');

    expect(getTelemetryConfig().collectorUrl).toBe(
      'https://collector.example/v1'
    );
  });

  it('parses standard OTLP exporter headers without truncating values', async () => {
    vi.stubEnv('OTEL_COLLECTOR_URL', 'https://collector.example');
    vi.stubEnv(
      'OTEL_EXPORTER_OTLP_HEADERS',
      'x-sentry-auth=Sentry%20sentry_key%3Dpublic-key'
    );
    const { getTelemetryConfig } =
      await import('@/modules/kernel/infrastructure/config/telemetry');

    expect(getTelemetryConfig().collectorHeaders).toEqual({
      'x-sentry-auth': 'Sentry sentry_key=public-key',
    });
  });
  it('normalizes names and preserves encoded delimiters and source order', async () => {
    vi.stubEnv('OTEL_COLLECTOR_URL', 'https://collector.example');
    vi.stubEnv(
      'OTEL_EXPORTER_OTLP_HEADERS',
      'X-Key=old,x-key=middle,X-Key=new,x-value=a%2Cb%3Dc%3Bf'
    );
    const { getTelemetryConfig } =
      await import('@/modules/kernel/infrastructure/config/telemetry');
    expect(getTelemetryConfig().collectorHeaders).toEqual({
      'x-key': 'new',
      'x-value': 'a,b=c;f',
    });
  });

  it.each([
    'x-token=literal%ZZ',
    'x-token=abc;metadata',
    'x-token=valid,',
    'missing',
    '=empty-name',
    'empty-value=',
  ])('rejects a silently dropped collector credential: %s', async (value) => {
    vi.stubEnv('OTEL_COLLECTOR_URL', 'https://collector.example');
    vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', value);
    const { getTelemetryConfig } =
      await import('@/modules/kernel/infrastructure/config/telemetry');
    expect(getTelemetryConfig).toThrow('OTEL_EXPORTER_OTLP_HEADERS');
  });

  it.each([
    'bad%0Aname=credential-sentinel',
    'bad%20name=credential-sentinel',
    'x-token=credential-sentinel%0D%0Avalue',
    'x-token=credential-sentinel%00value',
  ])(
    'rejects invalid decoded HTTP headers without exposing their values: %s',
    async (value) => {
      vi.stubEnv('OTEL_COLLECTOR_URL', 'https://collector.example');
      vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', value);
      const { getTelemetryConfig } =
        await import('@/modules/kernel/infrastructure/config/telemetry');
      expect(getTelemetryConfig).toThrow(
        'Invalid OTEL_EXPORTER_OTLP_HEADERS: expected supported HTTP header names and values.'
      );
      let failure: unknown;
      try {
        getTelemetryConfig();
      } catch (error) {
        failure = error;
      }
      const serialized = JSON.stringify(
        failure,
        Object.getOwnPropertyNames(failure)
      );
      expect(serialized).not.toContain(value);
      expect(serialized).not.toContain(decodeURIComponent(value));
      expect(failure).toHaveProperty('cause', undefined);
      expect(failure).toHaveProperty('details', undefined);
      expect((failure as Error).message).not.toContain(
        decodeURIComponent(value.split('=').slice(1).join('='))
      );
      expect(serialized).not.toContain('credential-sentinel');
    }
  );
  it.each([
    'OTEL_EXPORTER_OTLP_HEADERS',
    'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
    'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
    'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
  ])('validates %s after SDK parsing', async (variable) => {
    vi.stubEnv('OTEL_COLLECTOR_URL', 'https://collector.example');
    vi.stubEnv(variable, 'x-token=secret%0Avalue');
    const { getTelemetryConfig } =
      await import('@/modules/kernel/infrastructure/config/telemetry');
    expect(getTelemetryConfig).toThrow(variable);
    expect(getTelemetryConfig).not.toThrow('secret');
  });

  it.each([
    'connection',
    'keep-alive',
    'proxy-connection',
    'transfer-encoding',
    'upgrade',
    'expect',
    'te',
    'trailer',
    'host',
    'content-length',
  ])('rejects transport-controlled %s', async (name) => {
    vi.stubEnv('OTEL_COLLECTOR_URL', 'https://collector.example');
    vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', `${name}=value`);
    const { getTelemetryConfig } =
      await import('@/modules/kernel/infrastructure/config/telemetry');
    expect(getTelemetryConfig).toThrow('OTEL_EXPORTER_OTLP_HEADERS');
  });

  it('rejects invalid explicit bearer credentials', async () => {
    vi.stubEnv('OTEL_COLLECTOR_URL', 'https://collector.example');
    vi.stubEnv('OTEL_COLLECTOR_BEARER_TOKEN', 'secret\nvalue');
    const { getTelemetryConfig } =
      await import('@/modules/kernel/infrastructure/config/telemetry');
    expect(getTelemetryConfig).toThrow('OTEL_COLLECTOR_BEARER_TOKEN');
    expect(getTelemetryConfig).not.toThrow('secret');
  });

  it('ignores unused invalid collector headers in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OTEL_COLLECTOR_URL', undefined);
    vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', 'x-token=secret%0Avalue');
    vi.stubEnv('OTEL_EXPORTER_OTLP_TRACES_HEADERS', 'host=invalid');
    vi.stubEnv('SENTRY_DSN', 'https://public@sentry.example/1');
    const { getTelemetryConfig } =
      await import('@/modules/kernel/infrastructure/config/telemetry');
    expect(getTelemetryConfig()).toMatchObject({
      dsn: 'https://public@sentry.example/1',
      collectorHeaders: {},
      signalHeaders: { traces: {}, metrics: {}, logs: {} },
    });
  });

  it('disables only malformed OTLP config under the explicit validation bypass', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SKIP_ENV_VALIDATION', 'true');
    vi.stubEnv('OTEL_COLLECTOR_URL', 'https://collector.example');
    vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', 'x-token=secret;metadata');
    vi.stubEnv('SENTRY_DSN', 'https://public@sentry.example/1');
    vi.stubEnv('SENTRY_ENVIRONMENT', 'production');
    const diagnostic = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const { getTelemetryConfig } =
      await import('@/modules/kernel/infrastructure/config/telemetry');
    const config = getTelemetryConfig();
    expect(config.collectorUrl).toBeUndefined();
    expect(config).toMatchObject({
      dsn: 'https://public@sentry.example/1',
      environment: 'production',
      resolvedHeaders: { traces: {}, metrics: {}, logs: {} },
    });
    getTelemetryConfig();
    expect(diagnostic).toHaveBeenCalledOnce();
    expect(String(diagnostic.mock.calls[0]?.[0])).toContain(
      'telemetry.config_invalid'
    );
    expect(String(diagnostic.mock.calls[0]?.[0])).toContain(
      '"component":"otel"'
    );
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('secret');
  });
  it('build preflight leaves every runtime configuration cache empty', async () => {
    vi.resetModules();
    environment.build = {};
    vi.stubEnv('SKIP_ENV_VALIDATION', 'true');
    const { validateServerConfig } =
      await import('@/modules/kernel/infrastructure/config/server');
    vi.stubEnv('SKIP_ENV_VALIDATION', 'false');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_REGION', undefined);
    vi.stubEnv('AUTH_SECRET', 'b'.repeat(32));
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/build');
    vi.stubEnv('OTEL_COLLECTOR_URL', 'http://127.0.0.1:43191');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'http://127.0.0.1:9991');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'build-placeholder');
    vi.stubEnv('LOGGER_LEVEL', 'warn');
    vi.stubEnv('SENTRY_DSN', 'http://public@127.0.0.1:43191/1');
    vi.stubEnv('VITE_SENTRY_DSN', undefined);
    validateServerConfig('build');

    vi.stubEnv('VERCEL_REGION', 'sfo1');
    vi.stubEnv('AUTH_SECRET', 'r'.repeat(32));
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/runtime');
    vi.stubEnv('OTEL_COLLECTOR_URL', 'http://127.0.0.1:43192');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'runtime-placeholder');
    vi.stubEnv('LOGGER_LEVEL', 'error');
    vi.stubEnv('SENTRY_DSN', 'http://public@127.0.0.1:43192/2');
    const { getAuthConfig } =
      await import('@/modules/kernel/infrastructure/config/auth');
    const { getDatabaseConfig } =
      await import('@/modules/kernel/infrastructure/config/database');
    const { getLoggerConfig } =
      await import('@/modules/kernel/infrastructure/config/logger');
    const { getRedisConfig } =
      await import('@/modules/kernel/infrastructure/config/redis');
    const { getTelemetryConfig } =
      await import('@/modules/kernel/infrastructure/config/telemetry');
    expect(getAuthConfig().secret).toBe('r'.repeat(32));
    expect(getDatabaseConfig().databaseUrl).toBe(
      'postgres://localhost/runtime'
    );
    expect(getLoggerConfig().level).toBe('error');
    expect(getRedisConfig()?.restToken).toBe('runtime-placeholder');
    expect(getTelemetryConfig()).toMatchObject({
      collectorUrl: 'http://127.0.0.1:43192',
      dsn: 'http://public@127.0.0.1:43192/2',
    });
  });
});
