/**
 * Rep writes (Phase 3).
 *
 * A rep is a login *and* a master record, so the two are created together: a
 * login without a rep row could sign in and then find nothing, because every
 * scoped query keys on the rep id (Section 4).
 *
 * Deactivating a rep also suspends the account and kills its live sessions, so
 * "switched off" takes effect now rather than when a cookie expires - the same
 * rule Phase 1 applies to a suspended user.
 */
import { AuditAction, Role } from '@prisma/client';

import { Decimal } from '@/lib/format';
import { generateTemporaryPassword, hashPassword } from '@/lib/passwords';
import { withTransaction } from '@/lib/prisma';
import { writeAudit } from '@/server/audit/service';
import { revokeAllSessions } from '@/server/auth/session';
import { ValidationError, type Actor } from '@/server/data/access';
import { isUniqueViolation, nextDocumentNumber } from '@/server/data/numbers';
import type { AuditTrail } from '@/server/customers/service';

export interface RepInput {
  name: string;
  phone: string;
  username: string | null;
  maxDiscountPercent: Decimal;
  hiredAt: Date | null;
}

function auditContext(actor: Actor, trail: AuditTrail) {
  return {
    actorUserId: actor.userId,
    actorRole: actor.role,
    ip: trail.ip,
    userAgent: trail.userAgent,
  };
}

async function rethrowAsValidation<T>(operation: () => Promise<T>, message: string): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isUniqueViolation(error)) throw new ValidationError(message);
    throw error;
  }
}

export async function createRep(
  actor: Actor,
  input: RepInput,
  trail: AuditTrail,
): Promise<{ id: string; temporaryPassword: string }> {
  const temporary = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporary);

  return withTransaction(async (tx) => {
    const user = await rethrowAsValidation(
      () =>
        tx.user.create({
          data: {
            role: Role.REP,
            phone: input.phone,
            username: input.username ? input.username.toLowerCase() : null,
            passwordHash,
            mustChangePassword: true,
            isActive: true,
          },
          select: { id: true },
        }),
      'رقم الموبايل أو اسم المستخدم مستخدم بالفعل',
    );

    const rep = await tx.rep.create({
      data: {
        userId: user.id,
        code: await nextDocumentNumber(tx, 'REP_CODE'),
        name: input.name,
        phone: input.phone,
        maxDiscountPercent: input.maxDiscountPercent,
        hiredAt: input.hiredAt,
      },
      select: { id: true, code: true },
    });

    await tx.passwordReset.create({
      data: {
        userId: user.id,
        issuedById: actor.userId,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.CREATE,
      entityType: 'Rep',
      entityId: rep.id,
      after: {
        code: rep.code,
        name: input.name,
        phone: input.phone,
        maxDiscountPercent: input.maxDiscountPercent.toFixed(2),
      },
      metadata: { userId: user.id, mustChangePassword: true },
    });

    return { id: rep.id, temporaryPassword: temporary };
  });
}

export async function updateRep(
  actor: Actor,
  id: string,
  input: RepInput,
  trail: AuditTrail,
): Promise<void> {
  const username = input.username ? input.username.toLowerCase() : null;

  await withTransaction(async (tx) => {
    const before = await tx.rep.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new ValidationError('المندوب غير موجود');

    const account = await tx.user.findUniqueOrThrow({
      where: { id: before.userId },
      select: { phone: true, username: true },
    });

    await tx.rep.update({
      where: { id },
      data: {
        name: input.name,
        phone: input.phone,
        maxDiscountPercent: input.maxDiscountPercent,
        hiredAt: input.hiredAt,
      },
    });

    // The phone and the username *are* the login, so they are written here too.
    // Editing them on the rep record alone would leave the office calling him on
    // one number while the account still answers to another: two truths for one
    // fact, with the uniqueness check only covering the account side.
    await rethrowAsValidation(
      () =>
        tx.user.update({
          where: { id: before.userId },
          data: { phone: input.phone, username },
        }),
      'رقم الموبايل أو اسم المستخدم مستخدم بالفعل',
    );

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.UPDATE,
      entityType: 'Rep',
      entityId: id,
      before: {
        name: before.name,
        phone: before.phone,
        maxDiscountPercent: before.maxDiscountPercent.toFixed(2),
        hiredAt: before.hiredAt ? before.hiredAt.toISOString().slice(0, 10) : null,
        loginPhone: account.phone,
        username: account.username,
      },
      after: {
        name: input.name,
        phone: input.phone,
        maxDiscountPercent: input.maxDiscountPercent.toFixed(2),
        hiredAt: input.hiredAt ? input.hiredAt.toISOString().slice(0, 10) : null,
        loginPhone: input.phone,
        username,
      },
    });
  });
}

/**
 * Switching a rep off takes the account down with it.
 *
 * `is_active` on the rep hides him from assignment pickers, but the login would
 * keep working until the cookie expired, so the account is suspended and its
 * sessions revoked in the same transaction.
 */
export async function setRepActive(
  actor: Actor,
  id: string,
  isActive: boolean,
  trail: AuditTrail,
): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await tx.rep.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new ValidationError('المندوب غير موجود');
    if (before.isActive === isActive) return;

    await tx.rep.update({ where: { id }, data: { isActive } });
    await tx.user.update({ where: { id: before.userId }, data: { isActive } });
    if (!isActive) {
      await revokeAllSessions(before.userId, tx);
    }

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.STATUS_CHANGE,
      entityType: 'Rep',
      entityId: id,
      before: { isActive: before.isActive },
      after: { isActive, accountSuspended: !isActive },
    });
  });
}

/**
 * Soft delete, refused while the rep still owns customers.
 *
 * Removing him would leave those customers with no current rep, and "exactly one
 * current rep" (Section 5.1) would stop being true for real data. Reassign them
 * first; the history keeps his name on everything done before that.
 *
 * The account goes down with the record, for the same reason it does when he is
 * switched off: `is_active` on the rep only hides him from assignment pickers, so
 * a login left running would keep working and resolve to a rep row that no
 * query is meant to return.
 */
export async function deleteRep(actor: Actor, id: string, trail: AuditTrail): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await tx.rep.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new ValidationError('المندوب غير موجود');

    const owned = await tx.customerRepAssignment.count({ where: { repId: id, toDate: null } });
    if (owned > 0) {
      throw new ValidationError('لا يمكن حذف مندوب له عملاء، أعد إسناد عملائه أولاً');
    }

    const deletedAt = new Date();

    await tx.rep.update({
      where: { id },
      data: { deletedAt, isActive: false },
    });
    await tx.user.update({ where: { id: before.userId }, data: { isActive: false } });
    await revokeAllSessions(before.userId, tx);

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.DELETE,
      entityType: 'Rep',
      entityId: id,
      before: { code: before.code, name: before.name, isActive: before.isActive },
      after: { deletedAt: deletedAt.toISOString(), isActive: false, accountSuspended: true },
    });
  });
}
