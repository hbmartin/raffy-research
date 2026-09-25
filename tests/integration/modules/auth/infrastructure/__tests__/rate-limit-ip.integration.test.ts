import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('production sign-in IP trust', () => {
  it.each([undefined, 'x-proxy-client-ip'])(
    'keeps spoofed forwarded addresses in one rate-limit bucket with %s',
    async (trustedHeader) => {
      const database = new DatabaseSync(':memory:');

      try {
        const options = {
          secret: 'rate-limit-test-secret-with-sufficient-length', // pragma: allowlist secret
          baseURL: 'http://127.0.0.1:3900',
          database,
          emailAndPassword: { enabled: true },
          rateLimit: { enabled: true },
          advanced: {
            ipAddress: {
              ipAddressHeaders: trustedHeader ? [trustedHeader] : [],
            },
          },
        };
        await (await getMigrations(options)).runMigrations();
        const auth = betterAuth(options);
        const statuses: number[] = [];
        for (let attempt = 0; attempt < 4; attempt++) {
          const headers = new Headers({
            'Content-Type': 'application/json',
            Origin: 'http://127.0.0.1:3900',
            'X-Forwarded-For': `192.0.2.${attempt + 1}`,
          });
          if (trustedHeader) headers.set(trustedHeader, '198.51.100.10');
          const response = await auth.handler(
            new Request('http://127.0.0.1:3900/api/auth/sign-in/email', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                email: 'missing@example.test',
                password: 'wrong', // pragma: allowlist secret
              }),
            })
          );
          statuses.push(response.status);
        }
        expect(statuses).toEqual([401, 401, 401, 429]);
      } finally {
        database.close();
      }
    }
  );
});
