import { definePlugin } from 'nitro';

import { envClient } from '@/platform/env/client';

import { getKernel } from './kernel';
import { drainNewsletterQueue } from './newsletter';

export default definePlugin((nitro) => {
  if (!envClient.DEV || envClient.VITE_ENV_NAME === 'tests') return;
  const timer = setInterval(() => {
    void drainNewsletterQueue('local', 10).catch((error: unknown) =>
      getKernel().logger.warn({
        event: 'newsletter.worker.failed',
        details: {
          message: error instanceof Error ? error.message : 'Worker failed',
        },
      })
    );
  }, 15_000);
  timer.unref();
  void drainNewsletterQueue('local', 10).catch((error: unknown) =>
    getKernel().logger.warn({
      event: 'newsletter.worker.failed',
      details: {
        message: error instanceof Error ? error.message : 'Worker failed',
      },
    })
  );
  nitro.hooks.hook('close', () => {
    clearInterval(timer);
  });
});
