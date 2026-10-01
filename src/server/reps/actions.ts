/**
 * Rep server actions (Phase 3).
 *
 * Rep administration is admin-only (`reps:write`), so unlike the customer
 * actions there is no "own scope" to fall back on: the permission decides, and
 * the service re-reads the row inside the transaction anyway so a rep deleted
 * between the check and the write cannot be edited.
 *
 * The temporary password is returned to the form rather than emailed: there is
 * no mailer in this project, and an admin who never sees the generated password
 * would otherwise lock his colleague out of the system he was just given access
 * to. It is shown once, exactly like the reset flow in `auth/actions.ts`.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { isValidEgyptianPhone, normalizePhone } from '@/lib/auth/identifiers';
import { PERMISSIONS, roleCan } from '@/lib/auth/permissions';
import { Decimal } from '@/lib/format';
import { logger } from '@/lib/logger';
import { assertFormCsrf, CSRF_FIELD, getSessionUser } from '@/server/auth/session';
import type { ActionResult, FormErrors } from '@/server/auth/actions';
import { loadActor, ValidationError } from '@/server/data/access';
import { requestContext } from '@/server/http/request-context';
import { createRep, deleteRep, setRepActive, updateRep } from '@/server/reps/service';

const GENERIC = 'تعذّر حفظ البيانات، حاول مرة أخرى';

function flatten(error: z.ZodError): FormErrors {
  const errors: FormErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

function payload(formData: FormData): Record<string, unknown> {
  return Object.fromEntries([...formData].filter(([key]) => key !== CSRF_FIELD));
}

/**
 * Empty means "no end date"; the column is nullable and an empty string is not.
 *
 * The parsed form comes back as a `Date` rather than a string so the service
 * receives the type the column actually stores - the `yyyy-mm-dd` shape is
 * checked first, because `new Date('31-12-2026')` is not an error, it is the
 * wrong date.
 */
const optionalDate = (message: string) =>
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === '') return null;
      if (!z.string().date().safeParse(value).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        return z.NEVER;
      }
      return new Date(`${value}T00:00:00.000Z`);
    })
    .nullable();

const maxDiscountPercent = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === '') return new Decimal(0);

    let parsed: Decimal;
    try {
      parsed = new Decimal(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'نسبة الخصم غير صالحة' });
      return z.NEVER;
    }
    if (!parsed.isFinite()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'نسبة الخصم غير صالحة' });
      return z.NEVER;
    }
    // Section 5.1 caps it at 100, and a discount is never a surcharge.
    if (parsed.isNegative() || parsed.greaterThan(100)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'نسبة الخصم يجب أن تكون بين صفر مئة',
      });
      return z.NEVER;
    }
    return parsed;
  });

const baseSchema = z
  .object({
    name: z.string().trim().min(2, 'اسم المندوب مطلوب').max(120),
    phone: z
      .string()
      .trim()
      .refine(isValidEgyptianPhone, 'رقم موبايل غير صالح')
      .transform(normalizePhone),
    username: z
      .string()
      .trim()
      .max(40, 'اسم المستخدم طويل جداً')
      .transform((value) => (value === '' ? null : value))
      .nullable(),
    maxDiscountPercent,
    hiredAt: optionalDate('تاريخ التعيين غير صالح'),
  })
  .strict();

const createSchema = baseSchema.strict();
const updateSchema = baseSchema.extend({ repId: z.string().uuid('معرّف غير صالح') }).strict();

const activeSchema = z
  .object({
    repId: z.string().uuid('معرّف غير صالح'),
    isActive: z.enum(['true', 'false']).transform((value) => value === 'true'),
  })
  .strict();

const idSchema = z.object({ repId: z.string().uuid('معرّف غير صالح') }).strict();

interface Authorised {
  actor: Awaited<ReturnType<typeof loadActor>>;
  trail: { ip: string | null; userAgent: string | null };
}

async function authorize(
  formData: FormData,
): Promise<{ ok: true; value: Authorised } | { ok: false; result: ActionResult }> {
  const session = await getSessionUser();
  try {
    await assertFormCsrf(formData, session);
  } catch {
    return {
      ok: false,
      result: {
        ok: false,
        errors: {},
        message: 'انتهت صلاحية الجلسة، حدّث الصفحة وحاول مرة أخرى',
      },
    };
  }
  if (!session) return { ok: false, result: { ok: false, errors: {}, message: 'انتهت الجلسة' } };

  const actor = await loadActor(session);
  if (!actor || !roleCan(actor.role, PERMISSIONS.REPS_WRITE)) {
    return { ok: false, result: { ok: false, errors: {}, message: 'ليست لديك صلاحية' } };
  }
  return { ok: true, value: { actor, trail: await requestContext() } };
}

function failure(error: unknown, entity: string): ActionResult {
  if (error instanceof ValidationError) {
    return { ok: false, errors: {}, message: error.message };
  }
  logger.error({ err: error, entity }, 'rep write failed');
  return { ok: false, errors: {}, message: GENERIC };
}

function revalidateReps(): void {
  revalidatePath('/[locale]/admin/reps', 'page');
}

export async function createRepAction(
  _previous: ActionResult<{ temporaryPassword: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ temporaryPassword: string }>> {
  const access = await authorize(formData);
  if (!access.ok) return access.result as ActionResult<{ temporaryPassword: string }>;

  const parsed = createSchema.safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    const created = await createRep(access.value.actor, parsed.data, access.value.trail);
    revalidateReps();
    return { ok: true, data: { temporaryPassword: created.temporaryPassword } };
  } catch (error) {
    return failure(error, 'Rep') as ActionResult<{ temporaryPassword: string }>;
  }
}

export async function updateRepAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData);
  if (!access.ok) return access.result;

  const parsed = updateSchema.safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  const { repId, ...rest } = parsed.data;
  try {
    await updateRep(access.value.actor, repId, rest, access.value.trail);
  } catch (error) {
    return failure(error, 'Rep');
  }

  revalidateReps();
  return { ok: true, message: 'تم حفظ بيانات المندوب' };
}

/**
 * Switching a rep off also suspends the account, so the wording says "account
 * and access are off" rather than "deactivated": the admin needs to know the
 * login dies too.
 */
export async function setRepActiveAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData);
  if (!access.ok) return access.result;

  const parsed = activeSchema.safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await setRepActive(
      access.value.actor,
      parsed.data.repId,
      parsed.data.isActive,
      access.value.trail,
    );
  } catch (error) {
    return failure(error, 'Rep');
  }

  revalidateReps();
  return {
    ok: true,
    message: parsed.data.isActive ? 'تم تفعيل المندوب وحسابه' : 'تم إيقاف المندوب وحسابه',
  };
}

export async function deleteRepAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData);
  if (!access.ok) return access.result;

  const parsed = idSchema.safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await deleteRep(access.value.actor, parsed.data.repId, access.value.trail);
  } catch (error) {
    return failure(error, 'Rep');
  }

  revalidateReps();
  return { ok: true, message: 'تم حذف المندوب' };
}
