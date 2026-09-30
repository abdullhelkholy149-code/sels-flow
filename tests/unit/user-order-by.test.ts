/**
 * Sorting on the users list.
 *
 * The display name is assembled from the rep or the customer record rather than
 * stored on `users`, so "sort by name" has to be spelled as a chain of order
 * clauses. Getting this wrong is invisible to the type checker and fails at
 * runtime with a Prisma validation error, which is why it is pinned here.
 */
import { describe, expect, it } from 'vitest';

import { userOrderBy } from '@/server/users/queries';

/** The columns that really exist on `users`, in Prisma's naming. */
const USER_COLUMNS = new Set([
  'id',
  'role',
  'username',
  'phone',
  'email',
  'mustChangePassword',
  'isActive',
  'lastLoginAt',
  'failedLoginCount',
  'lockedUntil',
  'deletedAt',
  'createdAt',
  'updatedAt',
]);

describe('userOrderBy', () => {
  it('sorts a real column in the requested direction', () => {
    expect(userOrderBy('phone', 'asc')).toEqual({ phone: 'asc' });
    expect(userOrderBy('createdAt', 'asc')).toEqual({ createdAt: 'asc' });
    // Anything other than an explicit asc means desc, so a tampered or missing
    // direction cannot become an arbitrary value.
    expect(userOrderBy('lastLoginAt', undefined)).toEqual({ lastLoginAt: 'desc' });
  });

  it('falls back to the newest first for an unknown column', () => {
    expect(userOrderBy('passwordHash; DROP TABLE users', 'asc')).toEqual({ createdAt: 'desc' });
    expect(userOrderBy(undefined, undefined)).toEqual({ createdAt: 'desc' });
  });

  it('expands the display name into a chain instead of a missing column', () => {
    const clauses = userOrderBy('name', 'asc');

    expect(Array.isArray(clauses)).toBe(true);
    expect(clauses).toEqual([
      { rep: { name: 'asc' } },
      { customer: { name: 'asc' } },
      { username: 'asc' },
      { phone: 'asc' },
    ]);
  });

  it('flips every clause of the chain when the direction is desc', () => {
    expect(userOrderBy('name', 'desc')).toEqual([
      { rep: { name: 'desc' } },
      { customer: { name: 'desc' } },
      { username: 'desc' },
      { phone: 'desc' },
    ]);
  });

  it('ends the chain on a real column, so the order is never ambiguous', () => {
    // Without a final tie breaker two rows with the same name could swap places
    // between pages, and the same row would appear twice.
    const clauses = userOrderBy('name', 'asc') as Record<string, unknown>[];
    expect(clauses).toHaveLength(4);
    expect(clauses[clauses.length - 1]).toEqual({ phone: 'asc' });
  });

  it('never names a column that does not exist on users', () => {
    for (const sort of ['name', 'phone', 'role', 'isActive', 'lastLoginAt', 'createdAt']) {
      for (const direction of ['asc', 'desc'] as const) {
        const orderBy = userOrderBy(sort, direction);
        const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
        for (const clause of clauses) {
          for (const key of Object.keys(clause)) {
            // `rep` and `customer` are relations, the rest are columns.
            if (key === 'rep' || key === 'customer') continue;
            expect(USER_COLUMNS.has(key)).toBe(true);
          }
        }
      }
    }
  });
});
