import { Role, type Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { paginate, safeOrderBy, type ListQuery, type Page } from '@/server/data/access';

/**
 * Admin user list (Section 7: Users & roles) with the paging, search and
 * sorting that Section 3 requires on every list screen.
 *
 * Scoping note: this query is admin only, and the page calls
 * `requirePermissionFor` before reaching it. The service still takes the actor
 * so a future non admin call site cannot quietly read the whole table.
 */
const SORTABLE = ['phone', 'role', 'isActive', 'lastLoginAt', 'createdAt'] as const;
type Sortable = (typeof SORTABLE)[number];

/**
 * The display name is not a column on `users`: it lives on the rep or the
 * customer master record, with the username and then the phone as the fallback.
 * Prisma cannot sort on that expression, so "name" is spelled as a chain of
 * order clauses and `username` breaks the ties between rows that have no rep or
 * customer name. Sorting on a column that does not exist would fail the query,
 * so a screen must only declare real columns here.
 */
const NAME_ORDER: Prisma.UserOrderByWithRelationInput[] = [
  { rep: { name: 'asc' } },
  { customer: { name: 'asc' } },
  { username: 'asc' },
  { phone: 'asc' },
];

export function userOrderBy(sort: string | undefined, direction: 'asc' | 'desc' | undefined) {
  const dir = direction === 'asc' ? 'asc' : 'desc';
  if (sort === 'name') {
    return NAME_ORDER.map((clause) => reverseOrder(clause, dir));
  }
  return safeOrderBy<Sortable>(SORTABLE, sort, direction, { createdAt: 'desc' });
}

/** Flips every sort key of an order clause, including the nested relation one. */
function reverseOrder(
  clause: Prisma.UserOrderByWithRelationInput,
  dir: 'asc' | 'desc',
): Prisma.UserOrderByWithRelationInput {
  if ('rep' in clause && clause.rep) {
    return { rep: { name: dir } };
  }
  if ('customer' in clause && clause.customer) {
    return { customer: { name: dir } };
  }
  if ('username' in clause) return { username: dir };
  return { phone: dir };
}

export interface UserRow {
  id: string;
  role: Role;
  username: string | null;
  phone: string;
  name: string;
  isActive: boolean;
  mustChangePassword: boolean;
  locked: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export async function listUsers(query: ListQuery & { search?: string }): Promise<Page<UserRow>> {
  const search = query.search?.trim();
  const orderBy = userOrderBy(query.sort, query.direction);

  const where = search
    ? {
        OR: [
          { phone: { contains: search } },
          { username: { contains: search, mode: 'insensitive' as const } },
          { rep: { name: { contains: search, mode: 'insensitive' as const } } },
          { customer: { name: { contains: search, mode: 'insensitive' as const } } },
        ],
      }
    : {};

  return paginate<UserRow>(
    query,
    () => prisma.user.count({ where }),
    async ({ skip, take }) => {
      const users = await prisma.user.findMany({
        where,
        orderBy,
        // Paging happens in the database, not by slicing an array in memory.
        skip,
        take,
        include: {
          rep: { select: { name: true } },
          customer: { select: { name: true } },
        },
      });

      return users.map((user) => ({
        id: user.id,
        role: user.role,
        username: user.username,
        phone: user.phone,
        // The display name lives on the rep or the customer master record.
        name: user.rep?.name ?? user.customer?.name ?? user.username ?? user.phone,
        isActive: user.isActive && user.deletedAt === null,
        mustChangePassword: user.mustChangePassword,
        locked: user.lockedUntil !== null && user.lockedUntil > new Date(),
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      }));
    },
  );
}

/** Used by the "add user" form to warn about a phone number already in use. */
export async function isPhoneTaken(phone: string): Promise<boolean> {
  const count = await prisma.user.count({ where: { phone } });
  return count > 0;
}
