import { describe, expect, it } from 'vitest';

import { zListProviderCallbacksInput } from '@/modules/intelligence/transport/http/intelligence-handlers';

describe('intelligence HTTP handler input schemas', () => {
  it('accepts bounded positive integer callback limits', () => {
    expect(
      zListProviderCallbacksInput().parse({ workspaceId: 'ws-1', limit: 200 })
        .limit
    ).toBe(200);
    expect(
      zListProviderCallbacksInput().parse({ workspaceId: 'ws-1' }).limit
    ).toBeUndefined();
  });

  it.each([0, -1, 1.5, 201, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid callback limit %s',
    (limit) => {
      expect(() =>
        zListProviderCallbacksInput().parse({ workspaceId: 'ws-1', limit })
      ).toThrow();
    }
  );
});
