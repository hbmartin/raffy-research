import { definePlugin } from 'nitro';

import { envClient } from '@/platform/env/client';

import { drainNewsletterQueue } from './newsletter';

export default definePlugin((nitro) => {
  if (!envClient.DEV || envClient.VITE_ENV_NAME === 'tests') return;
  const timer = setInterval(() => {
    void drainNewsletterQueue('local', 10);
  }, 15_000);
  timer.unref();
  void drainNewsletterQueue('local', 10);
  nitro.hooks.hook('close', () => {
    clearInterval(timer);
  });
});
