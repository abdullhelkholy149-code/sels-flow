/**
 * Rep reads (Phase 3).
 *
 * Scoped by `repScope`, so a rep's own row is the only one he reads and an admin
 * reads the whole book. A rep's customer count is included because the admin
 * screen cannot delete a rep who still owns customers, and counting in the list
 * makes that visible before the button is pressed.
 */
import type { Prisma } from '@prisma/client';

import type { Decimal } from '@/lib/format';
import { prisma } from '@/lib/prisma';
import {
  paginate,
  repScope,
  safeOrderBy,
  type Actor,
  type ListQuery,
  type Page,
} from '@/server/data/access';

const SORTABLE = ['code', 'name', 'isActive', 'hiredAt', 'createdAt'] as const;
type Sortable = (typeof SORTABLE)[number];

export interface RepRow {
  id: string;
  code: string;
  name: string;
  phone: string;
  maxDiscountPercent: Decimal;
  isActive: boolean;
  hiredAt: Date | null;
  /** Customers currently assigned to him, i.e. open assignment rows. */
  customerCount: number;
  createdAt: Date;
}

export interface RepListFilters extends ListQuery {
  search?: string;
}

export async function listReps(actor: Actor, query: RepListFilters): Promise<Page<RepRow>> {
  const search = query.search?.trim();

  const and: Prisma.RepWhereInput[] = [repScope(actor)];
  if (search) {
    and.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ],
    });
  }

  const where: Prisma.RepWhereInput = { AND: and };
  const orderBy = safeOrderBy<Sortable>(SORTABLE, query.sort, query.direction, {
    name: 'asc',
  });

  return paginate<RepRow>(
    query,
    () => prisma.rep.count({ where }),
    async ({ skip, take }) => {
      const reps = await prisma.rep.findMany({
        where,
        orderBy,
        skip,
        take,
        include: { _count: { select: { assignments: { where: { toDate: null } } } } },
      });
      return reps.map((rep) => ({
        id: rep.id,
        code: rep.code,
        name: rep.name,
        phone: rep.phone,
        maxDiscountPercent: rep.maxDiscountPercent,
        isActive: rep.isActive && rep.deletedAt === null,
        hiredAt: rep.hiredAt,
        customerCount: rep._count.assignments,
        createdAt: rep.createdAt,
      }));
    },
  );
}
