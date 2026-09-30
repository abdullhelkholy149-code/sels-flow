/**
 * Audit trail (Section 3: every create/update/status change/approval/login/
 * failed login on business entities).
 *
 * Two rules make this trustworthy:
 *  1. `writeAudit` accepts a transaction client, so an audit row commits with
 *     the change it describes or not at all.
 *  2. It never throws. A logging failure must not roll back a completed
 *     business action; the failure is reported to the structured log instead.
 */
import { AuditAction, type Prisma } from '@prisma/client';

import { logger } from '@/lib/logger';
import type { Tx } from '@/lib/prisma';

export interface AuditContext {
  actorUserId?: string | null;
  actorRole?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuditEntry extends AuditContext {
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

type Db = Tx | Prisma.TransactionClient;

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === 'bigint' || item instanceof Date ? item.toString() : item,
    ),
  ) as Prisma.InputJsonValue;
}

export async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        actorUserId: entry.actorUserId ?? null,
        actorRole: (entry.actorRole as never) ?? null,
        beforeJson: toJson(entry.before),
        afterJson: toJson(entry.after),
        metadata: toJson(entry.metadata),
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  } catch (error) {
    logger.error(
      { err: error, action: entry.action, entityType: entry.entityType },
      'audit write failed',
    );
  }
}

/**
 * Field level diff used by admin screens: only the fields that actually
 * changed, so the audit viewer stays readable.
 */
export function diffRecords(
  before: object,
  after: object,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  const left = before as Record<string, unknown>;
  const right = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const a = left[key];
    const b = right[key];
    if (!sameValue(a, b)) {
      changedBefore[key] = a ?? null;
      changedAfter[key] = b ?? null;
    }
  }
  return { before: changedBefore, after: changedAfter };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || a === undefined) return b === null || b === undefined;
  return a === b;
}
