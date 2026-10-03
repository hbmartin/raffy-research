import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { createFixtureSupervisor } from './fixture-supervisor.mjs';
import { disposablePostgres } from '../tests/server/disposable-postgres.ts';

process.env.VITE_ENV_NAME = 'tests';
process.env.AUTH_SECRET = randomBytes(32).toString('hex');
process.env.NODE_ENV = 'development';
if (!process.env.E2E_DATABASE_URL)
  throw new Error(
    'E2E_DATABASE_URL must be supplied by the fixture environment'
  );
const fixtureDatabaseUrl = new URL(process.env.E2E_DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(fixtureDatabaseUrl.hostname))
  throw new Error('E2E database must be local');
process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
process.env.DATABASE_MIGRATION_URL = process.env.DATABASE_URL;
process.env.DATABASE_DRIVER = 'node-pg';
process.env.DATABASE_MIGRATION_DRIVER = 'node-pg';
const supervisor = createFixtureSupervisor({ childrenShareSignalGroup: true });
const require = createRequire(import.meta.url);
const vite = resolve(
  dirname(require.resolve('vite/package.json')),
  'bin/vite.js'
);
const postgres = await disposablePostgres('', {
  port: Number(fixtureDatabaseUrl.port),
  username: decodeURIComponent(fixtureDatabaseUrl.username) || 'postgres',
  database:
    decodeURIComponent(fixtureDatabaseUrl.pathname.slice(1)) || 'postgres',
});
const database = postgres
  ? undefined
  : new PGlite('memory://', { extensions: { pgcrypto } });
const socket = database
  ? new PGLiteSocketServer({
      db: database,
      host: '127.0.0.1',
      port: Number(fixtureDatabaseUrl.port),
      maxConnections: 16,
    })
  : undefined;
const run = (path) => supervisor.runNode(['./run-jiti', path]);
await supervisor.run(
  async () => {
    await database?.waitReady;
    supervisor.checkpoint();
    await database?.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    supervisor.checkpoint();
    await socket?.start();
    await Promise.all([
      (async () => {
        await run('./src/modules/kernel/infrastructure/db/migrate-cli.ts');
        await run('./drizzle/seed/index.ts');
      })(),
      run('./src/platform/env/client.ts'),
      run('./src/modules/kernel/infrastructure/config/server.ts'),
      run('./src/app/build-info/infrastructure/generate-build-info.ts'),
    ]);
    supervisor.checkpoint();
    await supervisor.runNode([vite, '--host', '0.0.0.0']);
  },
  async () => {
    try {
      await socket?.stop();
    } finally {
      await database?.close();
      await postgres?.close();
    }
  }
);
