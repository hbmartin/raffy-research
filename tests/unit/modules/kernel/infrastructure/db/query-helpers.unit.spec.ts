import { describe, expect, it } from 'vitest';

import {
  ascendingTextCursorFilter,
  escapedIlikeFilter,
  escapedLikePattern,
  takeCursorPage,
} from '@/modules/kernel/infrastructure/db/query-helpers';
import { emailStatus as emailStatusTable } from '@/modules/kernel/infrastructure/db/schema';

describe('db query helpers', () => {
  it('builds escaped LIKE patterns and optional filters', () => {
    expect(escapedLikePattern(' Alpha_ ')).toBe('%Alpha\\_%');
    expect(escapedIlikeFilter([emailStatusTable.subject], '')).toBeUndefined();
    expect(escapedIlikeFilter([], 'Alpha')).toBeUndefined();
    expect(
      escapedIlikeFilter([emailStatusTable.subject], 'Alpha')
    ).toBeDefined();
    expect(
      ascendingTextCursorFilter({
        sortColumn: emailStatusTable.subject,
        idColumn: emailStatusTable.id,
        cursor: { id: 'email-a', sortValue: 'Alpha' },
      })
    ).toBeDefined();
  });

  it('slices limit-plus-one rows into a cursor page', () => {
    const page = takeCursorPage(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      2,
      (row) => row.id
    );

    expect(page).toEqual({
      pageRows: [{ id: 'a' }, { id: 'b' }],
      nextCursor: 'b',
    });
  });
});
