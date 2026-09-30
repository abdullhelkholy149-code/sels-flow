/**
 * CSV export of the audit log.
 *
 * The log is append only and grows without bound, so the export is capped and
 * ordered newest first: the rows an admin is looking for are always inside the
 * cap, and the cap is a stated limit rather than a silent truncation.
 */
import { AuditAction, type Prisma } from '@prisma/client';

import { toCsv } from '@/lib/csv';
import { prisma } from '@/lib/prisma';
import type { AuditQuery } from '@/server/audit/queries';

const EXPORT_LIMIT = 10_000;

export async function exportAuditCsv(query: AuditQuery): Promise<string> {
  const where: Prisma.AuditLogWhereInput = {
    ...(query.action && query.action !== 'ALL' ? { action: query.action } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
  };

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { at: 'desc' },
    take: EXPORT_LIMIT,
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

  const headers = [
    'at',
    'action',
    'entityType',
    'entityId',
    'actor',
    'ip',
    'userAgent',
    'before',
    'after',
  ];

  return toCsv(
    headers,
    rows.map((row) => [
      row.at,
      row.action === AuditAction.DELETE ? 'DELETE' : row.action,
      row.entityType,
      row.entityId,
      row.actor?.rep?.name ?? row.actor?.customer?.name ?? row.actor?.username ?? null,
      row.ip,
      row.userAgent,
      row.beforeJson === null ? null : JSON.stringify(row.beforeJson),
      row.afterJson === null ? null : JSON.stringify(row.afterJson),
    ]),
  );
}
