/* oxlint-disable no-process-env */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { once } from 'node:events';
import { createServer } from 'node:http';

import { createFixtureSupervisor } from './fixture-supervisor.mjs';

import {
  readFixtureEnvironment,
  SSR_DATABASE_PORT,
  SSR_COLLECTOR_PORT,
} from './ssr-fixture-env';

const env = await readFixtureEnvironment();

const database = new PGlite('memory://', { extensions: { pgcrypto } });
const socket = new PGLiteSocketServer({
  db: database,
  host: '127.0.0.1',
  port: SSR_DATABASE_PORT,
  maxConnections: 16,
});
const collector = createServer((request, response) => {
  request.resume();
  const expected =
    request.url === '/v1/traces'
      ? 'trace-fixture'
      : request.url === '/v1/metrics'
        ? 'metric-fixture'
        : undefined;
  response.writeHead(
    expected && request.headers['x-fixture-auth'] !== expected ? 401 : 200,
    { 'Content-Type': 'application/x-protobuf' }
  );
  response.end();
});
const supervisor = createFixtureSupervisor();
await supervisor.run(
  async () => {
    await database.waitReady;
    supervisor.checkpoint();
    await database.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    supervisor.checkpoint();
    await socket.start();
    supervisor.checkpoint();
    collector.listen(SSR_COLLECTOR_PORT, '127.0.0.1');
    await once(collector, 'listening');
    for (const script of [
      './src/modules/kernel/infrastructure/db/migrate-cli.ts',
      './drizzle/seed/index.ts',
    ])
      await supervisor.runNode(['./run-jiti', script], env);
    await supervisor.runNode(['.output/server/index.mjs'], env);
  },
  async () => {
    collector.closeAllConnections();
    await new Promise<void>((resolve) => collector.close(() => resolve()));
    try {
      await socket.stop();
    } finally {
      await database.close();
    }
  }
);
