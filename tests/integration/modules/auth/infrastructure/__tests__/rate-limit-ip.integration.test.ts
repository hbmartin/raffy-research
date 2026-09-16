import { betterAuth } from 'better-auth';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('production sign-in IP trust', () => {
  it.each([undefined, 'x-proxy-client-ip'])(
    'keeps spoofed forwarded addresses in one rate-limit bucket with %s',
    async (trustedHeader) => {
      const database = new DatabaseSync(':memory:');
      database.exec(`
        CREATE TABLE "user" (
          "id" TEXT PRIMARY KEY NOT NULL,
          "name" TEXT NOT NULL,
          "email" TEXT NOT NULL UNIQUE,
          "emailVerified" INTEGER NOT NULL,
          "image" TEXT,
          "createdAt" INTEGER NOT NULL,
          "updatedAt" INTEGER NOT NULL
        )
      `);

      try {
        const auth = betterAuth({
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
        });
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
