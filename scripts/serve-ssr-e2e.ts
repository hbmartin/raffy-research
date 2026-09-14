/* oxlint-disable no-process-env */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';

import { SSR_BASE_URL, SSR_SEED_PASSWORD } from '../tests/support/ssr-e2e';

const database = new PGlite('memory://', { extensions: { pgcrypto } });
const socket = new PGLiteSocketServer({
  db: database,
  host: '127.0.0.1',
  port: 0,
  maxConnections: 16,
});
const collector = createServer((request, response) => {
  request.resume();
  response.writeHead(200, { 'Content-Type': 'application/x-protobuf' });
  response.end();
});
let child: ChildProcess | undefined;
let stopping = false;
let stopped: Promise<void> | undefined;

const stop = () => {
  if (stopped) return stopped;
  stopping = true;
  stopped = (async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close');
      child.kill('SIGTERM');
      const forceStop = setTimeout(() => child?.kill('SIGKILL'), 5_000);
      try {
        await closed;
      } finally {
        clearTimeout(forceStop);
      }
    }
    collector.closeAllConnections();
    collector.close();
    await socket.stop();
    await database.close();
  })();
  return stopped;
};

process.once('SIGTERM', () => {
  void stop();
});
process.once('SIGINT', () => {
  void stop();
});

try {
  await database.waitReady;
  await database.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  await socket.start();
  collector.listen(0, '127.0.0.1');
  await once(collector, 'listening');
  const address = collector.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing collector port');
  const collectorUrl = `http://127.0.0.1:${address.port}`;
  const sentryDsn = `http://public@127.0.0.1:${address.port}/1`;
  const env = {
    ...process.env,
    ALLOW_DEMO_SEED: 'true',
    AUTH_SECRET: randomBytes(32).toString('hex'),
    AUTH_PROVIDER: 'better-auth',
    DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/postgres`,
    DATABASE_MIGRATION_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/postgres`,
    DATABASE_DRIVER: 'node-pg',
    DATABASE_MIGRATION_DRIVER: 'node-pg',
    DEMO_SEED_PASSWORD: SSR_SEED_PASSWORD,
    GITHUB_CLIENT_ID: '',
    GITHUB_CLIENT_SECRET: '',
    HOST: '127.0.0.1',
    NODE_ENV: 'production',
    PORT: new URL(SSR_BASE_URL).port,
    VITE_PORT: new URL(SSR_BASE_URL).port,
    VITE_BASE_URL: SSR_BASE_URL,
    VITE_ENV_NAME: 'tests',
    VITE_IS_DEMO: 'false',
    VITE_VISUAL_TEST: 'false',
    VITE_SENTRY_DSN: sentryDsn,
    SENTRY_DSN: sentryDsn,
    SENTRY_AUTH_TOKEN: '',
    SENTRY_ORG: '',
    SENTRY_PROJECT: '',
    OTEL_COLLECTOR_URL: collectorUrl,
    OTEL_COLLECTOR_BEARER_TOKEN: '',
    OTEL_EXPORTER_OTLP_HEADERS: '',
    OTEL_EXPORTER_OTLP_TRACES_HEADERS: '',
    OTEL_EXPORTER_OTLP_METRICS_HEADERS: '',
    OTEL_EXPORTER_OTLP_LOGS_HEADERS: '',
    OTEL_LOCAL_SQLITE_ENABLED: 'false',
    SKIP_ENV_VALIDATION: 'false',
    LOGGER_PRETTY: 'false',
  };
  for (const command of ['e2e:db:init', 'build', 'start']) {
    if (stopping) break;
    // Launch the built server directly so shutdown targets the process that
    // owns database connections, rather than an intermediate package runner.
    child =
      command === 'start'
        ? spawn(process.execPath, ['.output/server/index.mjs'], {
            env,
            stdio: 'inherit',
          })
        : spawn('pnpm', [command], {
            env,
            stdio: 'inherit',
            shell: process.platform === 'win32',
          });
    const [code] = await once(child, 'exit');
    if (code !== 0 && !stopping)
      throw new Error(`pnpm ${command} failed with exit code ${code}`);
  }
} finally {
  await stop();
}
