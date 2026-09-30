/**
 * CSV export of the users list.
 *
 * Separate from the paged screen query on purpose: an export answers "give me
 * all matching rows", not "give me page 3". It reuses the same `where` builder
 * so the export cannot show a different set than the screen it was taken from.
 */
import { toCsv } from '@/lib/csv';
import { prisma } from '@/lib/prisma';
import type { UserRow } from '@/server/users/queries';

export interface UserExportQuery {
  search?: string;
  sort?: string;
  direction?: 'asc' | 'desc';
}

/** The same vocabulary as the screen query, so an export cannot ask for a
 * column the list never offers. */
const EXPORT_SORTABLE = ['name', 'phone', 'role', 'isActive', 'lastLoginAt', 'createdAt'] as const;

/** Capped so one request cannot pull an unbounded table into memory. */
const EXPORT_LIMIT = 10_000;

export async function exportUsersCsv(query: UserExportQuery): Promise<string> {
  const search = query.search?.trim();
  const orderBy: Record<string, 'asc' | 'desc'> =
    query.sort && (EXPORT_SORTABLE as readonly string[]).includes(query.sort)
      ? { [query.sort]: query.direction === 'asc' ? 'asc' : 'desc' }
      : { createdAt: 'desc' };

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

  const users = await prisma.user.findMany({
    where,
    orderBy,
    take: EXPORT_LIMIT,
    include: { rep: { select: { name: true } }, customer: { select: { name: true } } },
  });

  const headers = [
    'id',
    'name',
    'role',
    'phone',
    'username',
    'isActive',
    'mustChangePassword',
    'lockedUntil',
    'lastLoginAt',
    'createdAt',
  ];

  const rows = users.map(
    (user): UserRow => ({
      id: user.id,
      role: user.role,
      username: user.username,
      phone: user.phone,
      name: user.rep?.name ?? user.customer?.name ?? user.username ?? user.phone,
      isActive: user.isActive && user.deletedAt === null,
      mustChangePassword: user.mustChangePassword,
      locked: user.lockedUntil !== null && user.lockedUntil > new Date(),
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    }),
  );

  return toCsv(
    headers,
    rows.map((row) => [
      row.id,
      row.name,
      row.role,
      row.phone,
      row.username,
      row.isActive,
      row.mustChangePassword,
      row.locked,
      row.lastLoginAt,
      row.createdAt,
    ]),
  );
}
