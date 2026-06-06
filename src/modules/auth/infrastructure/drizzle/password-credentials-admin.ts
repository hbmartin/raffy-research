import { Result } from '@swan-io/boxed';
import { inArray, sql } from 'drizzle-orm';

import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { DbLike } from '@/modules/kernel/infrastructure/db/types';

import { account, user } from './schema';
import {
  betterAuthCredentialProviderId,
  hashBetterAuthPassword,
} from '../better-auth/password';

const accountPasswordColumn = 'password' as const;

type PasswordCredentialOutcome =
  | {
      type: 'password_credentials_set';
      email: string;
      userId: string;
    }
  | {
      type: 'user_not_found';
      email: string;
    };

type PasswordCredentialsForEmailsOutcome = {
  type: 'password_credentials_set';
  count: number;
};

function mapPasswordCredentialError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError({
    code: 'AUTH_PASSWORD_CREDENTIALS_ERROR',
    category: 'system',
    status: 500,
    message: 'Password credential update failed.',
    cause: error,
  });
}

async function upsertPasswordCredentials(
  db: DbLike,
  users: ReadonlyArray<{ id: string }>,
  password: string,
  now = new Date()
) {
  if (users.length === 0) return 0;

  const hashedPassword = await hashBetterAuthPassword(password);
  await db
    .insert(account)
    .values(
      users.map((existingUser) => ({
        accountId: existingUser.id,
        providerId: betterAuthCredentialProviderId,
        userId: existingUser.id,
        [accountPasswordColumn]: hashedPassword,
        createdAt: now,
        updatedAt: now,
      }))
    )
    .onConflictDoUpdate({
      target: [account.providerId, account.accountId],
      set: {
        [accountPasswordColumn]: hashedPassword,
        updatedAt: now,
      },
    });

  return users.length;
}

export async function setExistingUserPasswordCredential(
  db: DbLike,
  input: {
    email: string;
    password: string;
  }
): Promise<Result<PasswordCredentialOutcome, AppError>> {
  const normalizedEmail = input.email.trim().toLowerCase();

  try {
    const existingUser = await db.query.user.findFirst({
      where: sql`lower(${user.email}) = ${normalizedEmail}`,
    });

    if (!existingUser) {
      return Result.Ok({
        type: 'user_not_found',
        email: normalizedEmail,
      });
    }

    await upsertPasswordCredentials(db, [existingUser], input.password);
    return Result.Ok({
      type: 'password_credentials_set',
      email: existingUser.email,
      userId: existingUser.id,
    });
  } catch (error) {
    return Result.Error(mapPasswordCredentialError(error));
  }
}

export async function setUserPasswordCredentialsByEmail(
  db: DbLike,
  input: {
    emails: ReadonlyArray<string>;
    password: string;
  }
): Promise<Result<PasswordCredentialsForEmailsOutcome, AppError>> {
  const emails = input.emails.map((email) => email.trim().toLowerCase());

  try {
    const users = await db.query.user.findMany({
      where: inArray(user.email, emails),
    });
    const count = await upsertPasswordCredentials(db, users, input.password);
    return Result.Ok({
      type: 'password_credentials_set',
      count,
    });
  } catch (error) {
    return Result.Error(mapPasswordCredentialError(error));
  }
}
