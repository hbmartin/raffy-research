import { spawn } from 'node:child_process';

// All children inherit Playwright's process group. Never insert package runners
// here: they can create a new group which Playwright's final signal cannot reach.
export const createFixtureSupervisor = ({ failOnSignal = false } = {}) => {
  const children = new Map();
  const requested = Promise.withResolvers();
  let stopping = false;
  let shutdown;
  let startup = Promise.resolve();
  let cleanup = async () => {};
  const checkpoint = () => {
    if (stopping) throw new Error('Fixture shutdown requested');
  };
  const stop = () => {
    if (shutdown) return shutdown;
    stopping = true;
    requested.resolve();
    const deadline = setTimeout(() => {
      console.error('Fixture cleanup exceeded ten seconds');
      process.exit(1);
    }, 10_000);
    const active = [...children];
    for (const [child] of active) child.kill('SIGTERM');
    const escalate = setTimeout(() => {
      for (const [child] of children) child.kill('SIGKILL');
    }, 5_000);
    shutdown = (async () => {
      let cleaned = false;
      try {
        await Promise.allSettled(active.map(([, exited]) => exited));
        await startup.catch(() => {});
        await cleanup();
        cleaned = true;
      } finally {
        clearTimeout(escalate);
        if (cleaned) {
          clearTimeout(deadline);
          process.removeListener('SIGINT', onInterrupt);
          process.removeListener('SIGTERM', onTerminate);
        }
        // A rejected closer can leave handles open. Keep the deadline and
        // persistent signal handlers until the process has actually stopped.
      }
    })();
    return shutdown;
  };
  const onSignal = (exitCode) => {
    if (failOnSignal && process.exitCode === undefined)
      process.exitCode = exitCode;
    void stop().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  };
  const onInterrupt = () => onSignal(130);
  const onTerminate = () => onSignal(143);
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  return {
    checkpoint,
    waitForStop: () => requested.promise,
    runNode: async (args, env = process.env) => {
      checkpoint();
      const child = spawn(process.execPath, args, { env, stdio: 'inherit' });
      const exited = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => {
          children.delete(child);
          if (code === 0 || stopping) resolve();
          else
            reject(
              new Error(`Node ${args.join(' ')} exited with ${signal ?? code}`)
            );
        });
      });
      children.set(child, exited);
      await exited;
      checkpoint();
    },
    run: async (start, close) => {
      cleanup = close;
      startup = Promise.resolve().then(start);
      try {
        await startup;
      } catch (error) {
        if (!stopping) {
          console.error(error);
          process.exitCode = 1;
        }
      } finally {
        await stop();
      }
    },
  };
};
