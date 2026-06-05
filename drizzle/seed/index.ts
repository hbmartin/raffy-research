import { faker } from '@faker-js/faker';

import { getDefaultDbClient } from '@/modules/kernel/infrastructure/db/client';

import { createUsers } from './user';
import { createWorkspaces } from './workspace';

const SEED = 0x5eed;

async function main() {
  faker.seed(SEED);
  await createUsers();
  await createWorkspaces();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDefaultDbClient().$close();
  });
