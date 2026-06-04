import { faker } from '@faker-js/faker';

import { getDefaultDbClient } from '@/modules/kernel/infrastructure/db/client';

import { createIntelligenceFixtures } from './intelligence';
import { createUsers } from './user';

const SEED = 0x5eed;

async function main() {
  faker.seed(SEED);
  await createUsers();
  await createIntelligenceFixtures();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDefaultDbClient().$close();
  });
