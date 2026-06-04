import { faker } from '@faker-js/faker';

import { getDefaultDbClient } from '@/modules/kernel/infrastructure/db/client';

import { createUsers } from './user';

const SEED = 0x5eed;

async function main() {
  faker.seed(SEED);
  await createUsers();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDefaultDbClient().$close();
  });
