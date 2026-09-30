import { AuditAction, type Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { paginate, safeOrderBy, type ListQuery, type Page } from '@/server/data/access';

/**
 * Audit log viewer (Section 7). Read only by design: the table is append only
 * and nothing in the application updates or deletes a row.
 */
const SORTABLE = ['at', 'action', 'entityType'] as const;
type Sortable = (typeof SORTABLE)[number];

export interface AuditRow {
  id: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  actorUserId: string | null;
  actorName: string | null;
  ip: string | null;
  at: Date;
  changes: { before: unknown; after: unknown } | null;
}

export interface AuditQuery extends ListQuery {
  action?: AuditAction | 'ALL';
  entityType?: string;
}

export async function listAuditLog(query: AuditQuery): Promise<Page<AuditRow>> {
  const orderBy = safeOrderBy<Sortable>(SORTABLE, query.sort, query.direction, { at: 'desc' });

  const where: Prisma.AuditLogWhereInput = {
    ...(query.action && query.action !== 'ALL' ? { action: query.action } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
  };

  return paginate<AuditRow>(
    query,
    () => prisma.auditLog.count({ where }),
    async ({ skip, take }) => {
      const rows = await prisma.auditLog.findMany({
        where,
        orderBy,
        // Paging in the database: the audit log grows without bound.
        skip,
        take,
        include: {
          actor: {
            select: {
              rep: { select: { name: true } },
              customer: { select: { name: true } },
              username: true,
            },
          },
        },
      });

      return rows.map((row) => {
        const before = row.beforeJson;
        const after = row.afterJson;
        const hasChanges =
          (before !== null && before !== undefined) || (after !== null && after !== undefined);

        return {
          id: row.id,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          actorUserId: row.actorUserId,
          actorName:
            row.actor?.rep?.name ?? row.actor?.customer?.name ?? row.actor?.username ?? null,
          ip: row.ip,
          at: row.at,
          changes: hasChanges ? { before, after } : null,
        };
      });
    },
  );
}

/** Distinct entity types present in the log, for the filter dropdown. */
export async function listAuditedEntityTypes(): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({
    distinct: ['entityType'],
    select: { entityType: true },
    orderBy: { entityType: 'asc' },
  });
  return rows.map((row) => row.entityType);
}
