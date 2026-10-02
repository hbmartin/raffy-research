import { describe, expect, it } from 'vitest';

import { isClientDisconnect } from '../../../scripts/vite-client-disconnect';

describe('Local browser disconnect handling', () => {
  it('recognizes Node cancellation only after the client aborted its request', () => {
    const disconnected = Object.assign(new Error('aborted'), {
      code: 'ECONNRESET',
    });
    expect(isClientDisconnect(disconnected, true)).toBe(true);
    expect(isClientDisconnect(disconnected, false)).toBe(false);
    expect(
      isClientDisconnect(new Error('Unexpected generation failure'), true)
    ).toBe(false);
    expect(
      isClientDisconnect(
        { code: 'ECONNRESET', message: 'Connection failed' },
        true
      )
    ).toBe(false);
  });
});
