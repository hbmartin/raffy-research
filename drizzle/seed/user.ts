/* oxlint-disable no-process-env */
import { faker } from '@faker-js/faker';
import { notInArray, sql } from 'drizzle-orm';

import { setUserPasswordCredentialsByEmail } from '@/modules/auth/backend';
import { getDefaultDbClient } from '@/modules/kernel/infrastructure/db/client';
import { user } from '@/modules/kernel/infrastructure/db/schema';

import { emphasis } from './_utils';

const demoUserEmails = ['user@user.com', 'admin@admin.com'];
const demoOnboardedAt = new Date('2024-01-01T00:00:00.000Z');

function isLocalDatabaseUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname;
    return ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname);
  } catch {
    return false;
  }
}

function resolveDemoSeedPassword(): string {
  const password = process.env.DEMO_SEED_PASSWORD;
  if (!password) {
    throw new Error(
      'DEMO_SEED_PASSWORD is required before seeding demo users.'
    );
  }

  const explicitlyAllowed = process.env.ALLOW_DEMO_SEED === 'true';
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL_ENV === 'production';
  if (
    !explicitlyAllowed &&
    (isProduction || !isLocalDatabaseUrl(process.env.DATABASE_URL))
  ) {
    throw new Error(
      'Refusing to seed demo users outside a local database. Set ALLOW_DEMO_SEED=true only for an intentional non-local demo seed.'
    );
  }

  return password;
}

export async function createUsers() {
  console.log(`⏳ Seeding users`);
  const db = getDefaultDbClient();
  const demoPassword = resolveDemoSeedPassword();

  let createdCounter = 0;
  const [countRow] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(user)
    .where(notInArray(user.email, demoUserEmails));
  const existingRandomUserCount = countRow?.count ?? 0;

  const usersToSeed = Array.from(
    { length: Math.max(0, 98 - existingRandomUserCount) },
    () => ({
      name: faker.person.fullName(),
      email: faker.internet.email().toLowerCase(),
      emailVerified: true,
      role: 'user' as const,
    })
  );

  if (usersToSeed.length > 0) {
    const inserted = await db
      .insert(user)
      .values(usersToSeed)
      .onConflictDoNothing()
      .returning({ id: user.id });
    createdCounter += inserted.length;
  }

  const [insertedUser] = await db
    .insert(user)
    .values({
      name: 'User',
      email: 'user@user.com',
      emailVerified: true,
      onboardedAt: demoOnboardedAt,
      role: 'user',
    })
    .onConflictDoNothing()
    .returning({ id: user.id });
  if (insertedUser) {
    createdCounter += 1;
  }

  const [insertedAdmin] = await db
    .insert(user)
    .values({
      name: 'Admin',
      email: 'admin@admin.com',
      emailVerified: true,
      role: 'admin',
      onboardedAt: demoOnboardedAt,
    })
    .onConflictDoNothing()
    .returning({ id: user.id });
  if (insertedAdmin) {
    createdCounter += 1;
  }

  const demoUsers = await db.query.user.findMany({
    where: sql`lower(${user.email}) in (${sql.join(
      demoUserEmails.map((email) => sql`${email}`),
      sql`, `
    )})`,
  });
  const passwordInput = {
    emails: demoUsers.map((demoUser) => demoUser.email),
    password: demoPassword,
  };
  const passwordResult = await setUserPasswordCredentialsByEmail(
    db,
    passwordInput
  );
  if (passwordResult.isError()) throw passwordResult.getError();
  if (passwordResult.get().count !== demoUserEmails.length) {
    throw new Error(
      `Expected to set ${demoUserEmails.length} demo passwords, set ${passwordResult.get().count}.`
    );
  }

  console.log(
    `✅ ${existingRandomUserCount} existing random users 👉 ${createdCounter} users created`
  );
  console.log(`👉 Admin connect with: ${emphasis('admin@admin.com')}`);
  console.log(`👉 User connect with: ${emphasis('user@user.com')}`);
}
