import { createServer } from 'node:net';

import { createFixtureSupervisor } from '../../../scripts/fixture-supervisor.mjs';

const supervisor = createFixtureSupervisor({
  failOnSignal: process.argv[2] === 'signal-failure',
  childrenShareSignalGroup: process.argv[2] === 'group-signal',
});
const server = createServer();
await supervisor.run(
  async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    console.log(`PORT:${server.address().port}`);
    const mode = process.argv[2];
    const child = supervisor.runNode([
      '-e',
      `
    const server = require('node:net').createServer();
    server.listen(0, '127.0.0.1', () => console.log('CHILD:' + process.pid + ':' + server.address().port));
    ${mode === 'stuck' ? "process.on('SIGTERM', () => {});" : ''}
    ${mode === 'group-signal' ? "process.on('SIGTERM', () => { console.log('CHILD_SIGTERM'); setTimeout(() => server.close(), 100); });" : ''}
  `,
    ]);
    if (mode === 'failure') {
      // Allow the child's owned listener to become observable before setup fails.
      await new Promise((resolve) => setTimeout(resolve, 300));
      void child.catch(() => {});
      throw new Error('intentional setup failure');
    }
    await child;
  },
  async () => {
    await new Promise((resolve) => server.close(resolve));
    console.log('CLEANED');
  }
);
