/**
 * Login, logout, password change and admin user management (Phase 1).
 *
 * Every action follows the same four steps, in this order:
 *   1. Zod `.strict()` parse, so unknown fields are rejected (Section 8)
 *   2. CSRF / session check
 *   3. the business rule, inside one transaction
 *   4. an audit row committed with the change
 *
 * User facing failures are Arabic and deliberately generic: a form that says
 * "this account does not exist" is an account enumeration oracle, so an
 * unknown account, a wrong password and a suspended account all produce the
 * same message.
 */
'use server';

import { AuditAction, Role } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { checkPassword } from '@/lib/auth/password-policy';
import { logger } from '@/lib/logger';
import { generateTemporaryPassword, hashPassword, verifyPassword } from '@/lib/passwords';
import { prisma, withTransaction } from '@/lib/prisma';
import { diffRecords, writeAudit } from '@/server/audit/service';
import {
  assertFormCsrf,
  clearSessionCookies,
  CSRF_FIELD,
  getSessionUser,
  logout,
  revokeAllSessions,
  rotateCsrfToken,
  setCsrfCookieValue,
  setSessionCookies,
  type SessionUser,
} from '@/server/auth/session';
import { login } from '@/server/auth/service';
import { assertPermission, loadActor, requirePhone, ValidationError } from '@/server/data/access';
import type { Actor } from '@/server/data/access';
import { isUniqueViolation, nextDocumentNumber } from '@/server/data/numbers';
import { requestContext } from '@/server/http/request-context';

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface FormErrors {
  [field: string]: string | undefined;
}

export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; errors: FormErrors; message?: string };

const GENERIC_INVALID = 'بيانات الدخول غير صحيحة';

function flatten(error: z.ZodError): FormErrors {
  const errors: FormErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

const CSRF_MESSAGE = 'انتهت صلاحية الجلسة، حدّث الصفحة وحاول مرة أخرى';

/**
 * Step 2 of every action: the double submit token must match, and a signed in
 * actor is resolved once here so no action has to remember to do either.
 *
 * A CSRF failure is not an exception the user should see a stack trace for, so
 * it comes back as an ordinary form message.
 */
async function authorize(
  formData: FormData,
): Promise<{ ok: true; session: SessionUser; actor: Actor } | { ok: false; message: string }> {
  const session = await getSessionUser();
  try {
    await assertFormCsrf(formData, session);
  } catch {
    return { ok: false, message: CSRF_MESSAGE };
  }
  if (!session) return { ok: false, message: 'انتهت الجلسة' };
  try {
    return { ok: true, session, actor: await loadActor(session) };
  } catch {
    return { ok: false, message: 'انتهت الجلسة' };
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const loginSchema = z
  .object({
    identifier: z.string().trim().min(1, 'أدخل رقم الموبايل أو اسم المستخدم'),
    password: z.string().min(1, 'أدخل كلمة المرور'),
  })
  .strict();

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'أدخل كلمة المرور الحالية'),
    newPassword: z.string().min(1, 'أدخل كلمة المرور الجديدة'),
    confirmPassword: z.string().min(1, 'أعد كتابة كلمة المرور الجديدة'),
  })
  .strict()
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'كلمتا المرور غير متطابقتين',
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ['newPassword'],
    message: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية',
  });

const userIdSchema = z.object({ userId: z.string().uuid('معرّف غير صالح') }).strict();

const setActiveSchema = userIdSchema.extend({ isActive: z.string() }).strict();

const createUserSchema = z
  .object({
    role: z.nativeEnum(Role),
    phone: z.string().trim().min(1, 'أدخل رقم الموبايل'),
    username: z.string().trim().min(3, 'اسم المستخدم 3 أحرف على الأقل').max(40).optional(),
    displayName: z.string().trim().min(2, 'أدخل الاسم').max(120),
  })
  .strict()
  .refine((value) => value.username !== '' || value.username === undefined, {
    path: ['username'],
    message: 'اسم المستخدم مطلوب',
  });

/**
 * The CSRF field is ours, not the caller's, so it is dropped before parsing.
 * `.strict()` then rejects any field the schema does not know, which is the
 * rule Section 8 asks for: an extra key is an error, not something to ignore.
 */
function payload(formData: FormData): Record<string, unknown> {
  return Object.fromEntries([...formData].filter(([key]) => key !== CSRF_FIELD));
}

// ---------------------------------------------------------------------------
// Login / logout
// ---------------------------------------------------------------------------

export async function loginAction(
  _previous: ActionResult<{ ok: true }> | null,
  formData: FormData,
): Promise<ActionResult<{ ok: true }>> {
  // There is no session yet, so the anonymous cookie set when the form rendered
  // is the reference. Without this check a hostile page could post credentials
  // into our action and sign the victim into an account the attacker chose.
  try {
    await assertFormCsrf(formData, null);
  } catch {
    return { ok: false, errors: {}, message: CSRF_MESSAGE };
  }

  const parsed = loginSchema.safeParse(payload(formData));
  if (!parsed.success) {
    return { ok: false, errors: flatten(parsed.error) };
  }

  const context = await requestContext();
  const result = await login({
    identifier: parsed.data.identifier,
    password: parsed.data.password,
    ip: context.ip,
    userAgent: context.userAgent,
  });

  if (result.status === 'ok') {
    // `login` created the session row and audited the event; the cookie pair
    // only has to point at it, and the readable CSRF cookie becomes the
    // session's own token so the next form already matches.
    await setSessionCookies(result.session);
    return { ok: true, data: { ok: true } };
  }

  if (result.status === 'locked') {
    return {
      ok: false,
      errors: {},
      message: 'الحساب مقفل مؤقتاً بسبب محاولات دخول خاطئة، حاول بعد قليل',
    };
  }
  if (result.status === 'rate_limited') {
    return { ok: false, errors: {}, message: 'تم تجاوز عدد المحاولات المسموح، حاول بعد قليل' };
  }
  // 'inactive' and 'invalid_credentials' are indistinguishable on purpose.
  return { ok: false, errors: {}, message: GENERIC_INVALID };
}

export async function logoutAction(formData: FormData): Promise<void> {
  // Logout is a mutation like any other, so the token is checked even though
  // the worst a forged request can do is end the victim's own session.
  const session = await getSessionUser();
  try {
    await assertFormCsrf(formData, session);
  } catch {
    // A stale form must still be able to sign the user out.
  }
  if (session) {
    const context = await requestContext();
    await logout(session.sessionId, context);
  }
  await clearSessionCookies();
  revalidatePath('/', 'layout');
}

// ---------------------------------------------------------------------------
// Change own password
// ---------------------------------------------------------------------------

export async function changePasswordAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData);
  if (!access.ok) return { ok: false, errors: {}, message: access.message };
  const current = access;

  const parsed = changePasswordSchema.safeParse(payload(formData));
  if (!parsed.success) {
    return { ok: false, errors: flatten(parsed.error) };
  }

  const policy = checkPassword(parsed.data.newPassword);
  if (!policy.ok) {
    return { ok: false, errors: { newPassword: policy.message ?? 'كلمة مرور ضعيفة' } };
  }

  const user = await prisma.user.findUnique({ where: { id: current.session.id } });
  if (!user) {
    return { ok: false, errors: {}, message: 'انتهت الجلسة، سجّل الدخول من جديد' };
  }

  if (!(await verifyPassword(user.passwordHash, parsed.data.currentPassword))) {
    await writeAudit(prisma, {
      action: AuditAction.LOGIN_FAILED,
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      actorRole: user.role,
      metadata: { reason: 'password_change_wrong_current' },
    });
    return { ok: false, errors: { currentPassword: 'كلمة المرور الحالية غير صحيحة' } };
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  const context = await requestContext();

  await withTransaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
    });
    // Every outstanding temporary password is now spent.
    await tx.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    // A password change invalidates every other session of the account.
    await tx.userSession.updateMany({
      where: { userId: user.id, id: { not: current.session.sessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // The token is rotated, so the readable cookie has to be refreshed to match
    // or the next form on this session would fail its own CSRF check.
    const csrfToken = await rotateCsrfToken(tx, current.session.sessionId);
    await setCsrfCookieValue(csrfToken);
    await writeAudit(tx, {
      action: AuditAction.PASSWORD_CHANGE,
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      actorRole: user.role,
      ip: context.ip,
      userAgent: context.userAgent,
      metadata: { selfService: true },
    });
  });

  logger.info({ userId: user.id }, 'password changed');
  return { ok: true, message: 'تم تغيير كلمة المرور بنجاح' };
}

// ---------------------------------------------------------------------------
// Admin: create user
// ---------------------------------------------------------------------------

export async function createUserAction(
  _previous: ActionResult<{ temporaryPassword: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ temporaryPassword: string }>> {
  const access = await authorize(formData);
  if (!access.ok) return { ok: false, errors: {}, message: access.message };
  const current = access;
  try {
    assertPermission(current.actor, PERMISSIONS.USERS_WRITE);
  } catch {
    return { ok: false, errors: {}, message: 'ليست لديك صلاحية' };
  }

  const parsed = createUserSchema.safeParse(payload(formData));
  if (!parsed.success) {
    return { ok: false, errors: flatten(parsed.error) };
  }

  let phone: string;
  try {
    phone = requirePhone(parsed.data.phone);
  } catch (error) {
    const message = error instanceof ValidationError ? error.message : 'رقم موبايل غير صالح';
    return { ok: false, errors: { phone: message } };
  }

  const { role, username, displayName } = parsed.data;
  const temporary = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporary);
  const context = await requestContext();

  try {
    await withTransaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          role,
          phone,
          username: username ? username.toLowerCase() : null,
          passwordHash,
          // Every account starts with a temporary password, including one an
          // admin creates from the admin screen.
          mustChangePassword: true,
          isActive: true,
        },
        select: { id: true },
      });

      // A rep or a customer login without its master record would be a shell
      // with no data behind it, so the record is created in the same
      // transaction as the login. The 1:1 link is made here because the user
      // row has to exist first.
      if (role === Role.REP) {
        await tx.rep.create({
          data: {
            code: await nextDocumentNumber(tx, 'REP_CODE'),
            name: displayName,
            phone,
            userId: created.id,
          },
        });
      }
      if (role === Role.CUSTOMER) {
        await tx.customer.create({
          data: {
            code: await nextDocumentNumber(tx, 'CUSTOMER_CODE'),
            name: displayName,
            userId: created.id,
          },
        });
      }

      await tx.passwordReset.create({
        data: {
          userId: created.id,
          issuedById: current.actor.userId,
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        },
      });

      await writeAudit(tx, {
        action: AuditAction.CREATE,
        entityType: 'User',
        entityId: created.id,
        actorUserId: current.actor.userId,
        actorRole: current.actor.role,
        after: { role, phone, username: username ?? null, mustChangePassword: true },
        ip: context.ip,
        userAgent: context.userAgent,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, errors: { phone: 'الرقم أو اسم المستخدم مستخدم بالفعل' } };
    }
    throw error;
  }

  revalidatePath('/[locale]/admin/users', 'page');
  return { ok: true, data: { temporaryPassword: temporary } };
}

// ---------------------------------------------------------------------------
// Admin: suspend / reactivate
// ---------------------------------------------------------------------------

export async function setUserActiveAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData);
  if (!access.ok) return { ok: false, errors: {}, message: access.message };
  const current = access;
  try {
    assertPermission(current.actor, PERMISSIONS.USERS_WRITE);
  } catch {
    return { ok: false, errors: {}, message: 'ليست لديك صلاحية' };
  }

  const parsed = setActiveSchema.safeParse(payload(formData));
  if (!parsed.success) {
    return { ok: false, errors: flatten(parsed.error) };
  }
  const isActive = parsed.data.isActive === 'true';
  const { userId } = parsed.data;

  if (userId === current.actor.userId && !isActive) {
    return { ok: false, errors: {}, message: 'لا يمكنك إيقاف حسابك الحالي' };
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true },
  });
  if (!target) return { ok: false, errors: {}, message: 'الحساب غير موجود' };

  const context = await requestContext();
  const change = diffRecords({ isActive: target.isActive }, { isActive });

  await withTransaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { isActive } });
    if (!isActive) {
      // Suspension takes effect now, not at cookie expiry (decision D-010).
      await revokeAllSessions(userId, tx);
    }
    await writeAudit(tx, {
      action: AuditAction.STATUS_CHANGE,
      entityType: 'User',
      entityId: userId,
      actorUserId: current.actor.userId,
      actorRole: current.actor.role,
      before: change.before,
      after: change.after,
      ip: context.ip,
      userAgent: context.userAgent,
    });
  });

  revalidatePath('/[locale]/admin/users', 'page');
  return { ok: true, message: isActive ? 'تم تفعيل الحساب' : 'تم إيقاف الحساب' };
}

// ---------------------------------------------------------------------------
// Admin: reset password
// ---------------------------------------------------------------------------

export async function resetPasswordAction(
  _previous: ActionResult<{ temporaryPassword: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ temporaryPassword: string }>> {
  const access = await authorize(formData);
  if (!access.ok) return { ok: false, errors: {}, message: access.message };
  const current = access;
  try {
    assertPermission(current.actor, PERMISSIONS.USERS_RESET_PASSWORD);
  } catch {
    return { ok: false, errors: {}, message: 'ليست لديك صلاحية' };
  }

  const parsed = userIdSchema.safeParse(payload(formData));
  if (!parsed.success) {
    return { ok: false, errors: flatten(parsed.error) };
  }
  const { userId } = parsed.data;

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!target) return { ok: false, errors: {}, message: 'الحساب غير موجود' };

  const temporary = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporary);
  const context = await requestContext();

  await withTransaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
    });
    // A reset is a compromise response: every live session dies with it.
    await revokeAllSessions(userId, tx);
    await tx.passwordReset.create({
      data: {
        userId,
        issuedById: current.actor.userId,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    await writeAudit(tx, {
      action: AuditAction.PASSWORD_RESET,
      entityType: 'User',
      entityId: userId,
      actorUserId: current.actor.userId,
      actorRole: current.actor.role,
      ip: context.ip,
      userAgent: context.userAgent,
      metadata: { sessionsRevoked: true },
    });
  });

  logger.info(
    { actorUserId: current.actor.userId, targetUserId: userId },
    'admin reset a password',
  );
  revalidatePath('/[locale]/admin/users', 'page');
  return { ok: true, data: { temporaryPassword: temporary } };
}
