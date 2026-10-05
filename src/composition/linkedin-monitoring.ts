import { createLinkedinMonitoring } from '@/modules/intelligence';
import {
  createLinkedinProviderTask,
  createLinkedinWatchlistRepository,
  getProviderCredential,
} from '@/modules/intelligence/backend';
import { systemClock } from '@/modules/kernel/infrastructure/clock/system-clock';
import type { Database } from '@/modules/kernel/infrastructure/db/types';

/** Trusted operator CLI composition; provider credentials stay inside adapters. */
export function composeLinkedinMonitoring(db: Database) {
  return createLinkedinMonitoring({
    clock: systemClock,
    repository: createLinkedinWatchlistRepository({ db }),
    providerTask: createLinkedinProviderTask({
      getCredential: getProviderCredential,
    }),
  });
}
