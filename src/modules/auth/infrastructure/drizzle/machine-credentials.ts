import { Result } from '@swan-io/boxed';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { PermissionChecker } from '@/modules/kernel/application/ports/permission-checker';
import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { DbLike } from '@/modules/kernel/infrastructure/db/types';

import { machineCredential } from './machine-schema';
import { user } from './schema';
import type {
  MachineCapability,
  MachineIdentity,
} from '../../domain/machine-credential';
import { hasRolePermission, type Permission } from '../../domain/permissions';

const digest = (secret: string) =>
  createHash('sha256').update(secret).digest('hex');
const boundary = async <T>(
  work: () => Promise<T>
): Promise<ApplicationResult<T>> => {
  try {
    return Result.Ok(await work());
  } catch (cause) {
    return Result.Error(
      new AppError({
        code: 'MACHINE_AUTH_STORAGE_FAILED',
        category: 'system',
        status: 500,
        message: 'Machine authentication storage failed',
        cause,
      })
    );
  }
};

export function createMachineCredentials(db: DbLike) {
  return {
    begin: (input: { name: string; capabilities: MachineCapability[] }) =>
      boundary(async () => {
        const id = randomUUID(),
          secret = randomBytes(32).toString('base64url'),
          code = randomBytes(4).toString('hex');
        const [row] = await db
          .insert(machineCredential)
          .values({
            id,
            secretHash: digest(secret),
            name: input.name,
            capabilities: input.capabilities,
            code,
            pairingExpiresAt: sql`clock_timestamp() + interval '10 minutes'`,
            expiresAt: sql`clock_timestamp() + interval '30 days'`,
          })
          .returning({ pairingExpiresAt: machineCredential.pairingExpiresAt });
        return {
          type: 'pairing_started' as const,
          id,
          secret,
          code,
          pairingExpiresAt: row!.pairingExpiresAt,
        };
      }),
    pairing: (id: string) =>
      boundary(async () => {
        const [row] = await db
          .select({
            id: machineCredential.id,
            name: machineCredential.name,
            code: machineCredential.code,
            capabilities: machineCredential.capabilities,
            state: machineCredential.state,
            expiresAt: machineCredential.expiresAt,
            pairingExpiresAt: machineCredential.pairingExpiresAt,
          })
          .from(machineCredential)
          .where(
            and(
              eq(machineCredential.id, id),
              sql`${machineCredential.pairingExpiresAt} > clock_timestamp()`
            )
          )
          .limit(1);
        return row
          ? { type: 'pairing_found' as const, pairing: row }
          : { type: 'pairing_expired' as const };
      }),
    approve: (input: {
      id: string;
      userId: string;
      code: string;
      approve: boolean;
    }) =>
      boundary(async () => {
        const [account] = await db
          .select()
          .from(user)
          .where(eq(user.id, input.userId))
          .limit(1);
        if (!account || account.banned) return { type: 'forbidden' as const };
        const [pending] = await db
          .select()
          .from(machineCredential)
          .where(
            and(
              eq(machineCredential.id, input.id),
              eq(machineCredential.code, input.code),
              eq(machineCredential.state, 'pending'),
              sql`${machineCredential.pairingExpiresAt} > clock_timestamp()`
            )
          )
          .limit(1);
        if (!pending) return { type: 'pairing_expired' as const };
        if (
          input.approve &&
          account.role !== 'admin' &&
          pending.capabilities.some(
            (scope) => scope === 'pipeline' || scope === 'lab'
          )
        )
          return { type: 'forbidden' as const };
        const rows = await db
          .update(machineCredential)
          .set({
            userId: account.id,
            state: input.approve ? 'approved' : 'denied',
          })
          .where(
            and(
              eq(machineCredential.id, input.id),
              eq(machineCredential.state, 'pending'),
              sql`${machineCredential.pairingExpiresAt} > clock_timestamp()`
            )
          )
          .returning({ id: machineCredential.id });
        return {
          type: rows.length
            ? input.approve
              ? ('credential_approved' as const)
              : ('pairing_denied' as const)
            : ('pairing_expired' as const),
        };
      }),
    authenticate: (
      id: string,
      secret: string
    ): Promise<
      ApplicationResult<
        | { type: 'machine_authenticated'; identity: MachineIdentity }
        | { type: 'machine_unauthorized' }
      >
    > =>
      boundary(async () => {
        const [row] = await db
          .select({ credential: machineCredential, account: user })
          .from(machineCredential)
          .innerJoin(user, eq(user.id, machineCredential.userId))
          .where(
            and(
              eq(machineCredential.id, id),
              eq(machineCredential.secretHash, digest(secret)),
              eq(machineCredential.state, 'approved'),
              sql`${machineCredential.expiresAt} > clock_timestamp()`,
              sql`coalesce(${user.banned}, false) = false`
            )
          )
          .limit(1);
        return row
          ? {
              type: 'machine_authenticated',
              identity: {
                credentialId: row.credential.id,
                userId: row.account.id,
                name: row.credential.name,
                role: row.account.role,
                capabilities: row.credential.capabilities,
              },
            }
          : { type: 'machine_unauthorized' };
      }),
    list: (
      userId: string,
      page: { limit: number; cursor?: string } = { limit: 20 }
    ) =>
      boundary(async () => {
        const cursor = page.cursor
          ? z
              .tuple([z.iso.datetime(), z.string()])
              .parse(
                JSON.parse(Buffer.from(page.cursor, 'base64url').toString())
              )
          : undefined;
        const rows = await db
          .select({
            id: machineCredential.id,
            name: machineCredential.name,
            state: machineCredential.state,
            capabilities: machineCredential.capabilities,
            expiresAt: machineCredential.expiresAt,
            createdAt: machineCredential.createdAt,
          })
          .from(machineCredential)
          .where(
            and(
              eq(machineCredential.userId, userId),
              cursor
                ? or(
                    lt(machineCredential.createdAt, new Date(cursor[0])),
                    and(
                      eq(machineCredential.createdAt, new Date(cursor[0])),
                      lt(machineCredential.id, cursor[1])
                    )
                  )
                : undefined
            )
          )
          .orderBy(
            desc(machineCredential.createdAt),
            desc(machineCredential.id)
          )
          .limit(page.limit + 1);
        const last = rows[page.limit - 1];
        return {
          type: 'credentials_listed' as const,
          credentials: rows.slice(0, page.limit),
          nextCursor:
            rows.length > page.limit && last
              ? Buffer.from(
                  JSON.stringify([last.createdAt.toISOString(), last.id])
                ).toString('base64url')
              : null,
        };
      }),
    revoke: (userId: string, id: string) =>
      boundary(async () => {
        const rows = await db
          .update(machineCredential)
          .set({ state: 'revoked' })
          .where(
            and(
              eq(machineCredential.id, id),
              eq(machineCredential.userId, userId)
            )
          )
          .returning({ id: machineCredential.id });
        return {
          type: rows.length
            ? ('credential_revoked' as const)
            : ('not_found' as const),
        };
      }),
  };
}

export function createMachinePermissionChecker(
  db: DbLike,
  credential: { id: string; secret: string }
): PermissionChecker {
  return {
    async hasPermission(userId, permissions) {
      const result = await createMachineCredentials(db).authenticate(
        credential.id,
        credential.secret
      );
      if (result.isError()) return Result.Error(result.getError());
      const outcome = result.get();
      const granted =
        outcome.type === 'machine_authenticated'
          ? outcome.identity.capabilities
          : [];
      const scoped = Object.entries(permissions).every(
        ([resource, actions]) => {
          if (
            resource === 'source' ||
            (resource === 'report' && actions.includes('score'))
          )
            return granted.includes('research');
          if (resource === 'report' || resource === 'workspace')
            return granted.length > 0;
          if (resource === 'apps')
            return granted.includes('pipeline') || granted.includes('lab');
          return false;
        }
      );
      return Result.Ok({
        type:
          scoped &&
          outcome.type === 'machine_authenticated' &&
          outcome.identity.userId === userId &&
          hasRolePermission(outcome.identity.role, permissions as Permission)
            ? 'permission_granted'
            : 'permission_denied',
      });
    },
  };
}
