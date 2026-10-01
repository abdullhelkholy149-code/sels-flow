/**
 * Customer server actions (Phase 3).
 *
 * Same four steps as every other action in the project: Zod `.strict()`, CSRF
 * and session, the business rule inside one transaction, and an audit row
 * committed with the change.
 *
 * Two things are worth reading before changing anything here:
 *
 *  - The permission and the *scope* are separate checks. A rep holds
 *    `customers:write_own`, so the action lets him through; the service then
 *    looks the customer up through `customerScope`, so passing somebody else's
 *    id finds nothing. Either check alone would be enough to be wrong: the
 *    permission alone trusts the caller, the scope alone trusts the caller not
 *    to have asked.
 *  - Messages are Arabic and say what the reader can act on. A missing field, a
 *    duplicated phone number and an out-of-scope id are all reported as "not
 *    found" or as a plain failure, never as a 403 on a guessed id (D-011).
 */
'use server';

import { CustomerStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { isValidEgyptianPhone, normalizePhone } from '@/lib/auth/identifiers';
import { PERMISSIONS, roleCan, type Permission } from '@/lib/auth/permissions';
import { Decimal } from '@/lib/format';
import { logger } from '@/lib/logger';
import { assertFormCsrf, CSRF_FIELD, getSessionUser } from '@/server/auth/session';
import type { ActionResult, FormErrors } from '@/server/auth/actions';
import { loadActor, ValidationError, type Actor } from '@/server/data/access';
import { requestContext } from '@/server/http/request-context';
import {
  createCustomer,
  createCustomerCategory,
  deleteCustomer,
  deleteCustomerCategory,
  reassignCustomer,
  setCustomerStatus,
  updateCreditTerms,
  updateCustomer,
  updateCustomerCategory,
} from '@/server/customers/service';

const GENERIC = 'تعذّر حفظ البيانات، حاول مرة أخرى';

function flatten(error: z.ZodError): FormErrors {
  const errors: FormErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

/** The CSRF field is ours, so it is dropped before parsing. */
function payload(formData: FormData): Record<string, unknown> {
  return Object.fromEntries([...formData].filter(([key]) => key !== CSRF_FIELD));
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

/** An empty text input means "not set", which the column stores as NULL. */
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => (value === '' ? null : value))
    .nullable();

const optionalUuid = (message: string) =>
  z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .refine((value) => value === null || z.string().uuid().safeParse(value).success, {
      message,
    });

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

/** NUMERIC(14,2) is the column, so anything larger is refused before the write. */
const MAX_MONEY = new Decimal('999999999999.99');

/**
 * Decimal parsing that reports problems as field errors.
 *
 * A `new Decimal('مجانا')` throws, and a throw inside `.transform()` escapes
 * `safeParse` and surfaces as a 500 instead of a message on the field, so the
 * conversion happens here and is reported through `ctx`.
 */
function parseDecimal(
  raw: string,
  ctx: z.RefinementCtx,
  options: { invalid: string; negative?: string; max?: string },
): Decimal {
  const value = raw.trim();
  if (value === '') return new Decimal(0);

  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: options.invalid });
    return z.NEVER;
  }
  if (!parsed.isFinite()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: options.invalid });
    return z.NEVER;
  }
  if (options.negative !== undefined && parsed.isNegative()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: options.negative });
    return z.NEVER;
  }
  if (parsed.abs().greaterThan(MAX_MONEY)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: options.max ?? options.invalid });
    return z.NEVER;
  }
  return parsed;
}

/**
 * E.164, because a login identifier has to be exactly one string: the same
 * number typed `0100…`, `+20100…` or `0020 10…` must not create three accounts.
 */
const phone = z
  .string()
  .trim()
  .refine(isValidEgyptianPhone, 'رقم موبايل غير صالح')
  .transform(normalizePhone);

const creditLimit = z
  .string()
  .trim()
  .transform((value, ctx) =>
    parseDecimal(value, ctx, {
      invalid: 'حد الائتمان غير صالح',
      negative: 'حد الائتمان لا يمكن أن يكون سالباً',
      max: 'حد الائتمان أكبر من الحد المسموح',
    }),
  );

/** Signed on purpose: an advance a customer already paid is a negative opening balance. */
const openingBalance = z
  .string()
  .trim()
  .transform((value, ctx) =>
    parseDecimal(value, ctx, {
      invalid: 'الرصيد الافتتاحي غير صالح',
      max: 'الرصيد الافتتاحي أكبر من الحد المسموح',
    }),
  );

const creditDays = z.coerce
  .number({ invalid_type_error: 'عدد أيام السداد غير صالح' })
  .int('عدد أيام السداد يجب أن يكون عدداً صحيحاً')
  .min(0, 'عدد أيام السداد لا يقل عن صفر')
  .max(3650, 'عدد أيام السداد غير منطقي');

const masterSchema = z
  .object({
    name: z.string().trim().min(2, 'اسم العميل مطلوب').max(160),
    tradeName: optionalText(160, 'الاسم التجاري طويل جداً'),
    contactPerson: z.string().trim().max(120, 'اسم المسؤول طويل جداً').nullable(),
    phone,
    address: optionalText(300, 'العنوان طويل جداً'),
    governorate: optionalText(80, 'اسم المحافظة طويل جداً'),
    city: optionalText(80, 'اسم المدينة طويل جداً'),
    categoryId: optionalUuid('تصنيف العميل غير صالح'),
    priceListId: optionalUuid('قائمة الأسعار غير صالحة'),
    receiverType: z.enum(['BUSINESS', 'PERSON', 'FOREIGN']),
    taxRegistrationNumber: optionalText(40, 'الرقم الضريبي طويل جداً'),
    nationalId: optionalText(40, 'الرقم القومي طويل جداً'),
    whatsappOptIn: flag.default('false'),
    notes: optionalText(1000, 'الملاحظات طويلة جداً'),
  })
  .strict();

const createSchema = masterSchema
  .extend({
    repId: optionalUuid('المندوب غير صالح'),
    username: optionalText(40, 'اسم المستخدم طويل جداً'),
    paymentTerms: z.enum(['CASH', 'CREDIT']),
    creditLimit,
    creditDays,
    openingBalance,
  })
  .strict();

const updateSchema = masterSchema
  .extend({ customerId: z.string().uuid('معرّف غير صالح') })
  .strict();

const creditTermsSchema = z
  .object({
    customerId: z.string().uuid('معرّف غير صالح'),
    paymentTerms: z.enum(['CASH', 'CREDIT']),
    creditLimit,
    creditDays,
  })
  .strict();

const statusSchema = z
  .object({
    customerId: z.string().uuid('معرّف غير صالح'),
    status: z.enum(['ACTIVE', 'BLOCKED', 'INACTIVE']),
  })
  .strict();

const reassignSchema = z
  .object({
    customerId: z.string().uuid('معرّف غير صالح'),
    repId: z.string().uuid('المندوب غير صالح'),
  })
  .strict();

const idSchema = z.object({ customerId: z.string().uuid('معرّف غير صالح') }).strict();
const categoryIdSchema = z.object({ categoryId: z.string().uuid('معرّف غير صالح') }).strict();

const categorySchema = z
  .object({
    name: z.string().trim().min(1, 'اسم التصنيف مطلوب').max(80),
    nameEn: optionalText(80, 'الاسم بالإنجليزية طويل جداً'),
  })
  .strict();

// ---------------------------------------------------------------------------
// Authorisation and failure wording
// ---------------------------------------------------------------------------

interface Authorised {
  actor: Actor;
  trail: { ip: string | null; userAgent: string | null };
}

/**
 * CSRF, session, then "holds at least one of these permissions". Listing the
 * permissions instead of testing a role name keeps `permissions.ts` the only
 * place that decides who may do what (D-013).
 */
async function authorize(
  formData: FormData,
  permissions: readonly Permission[],
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
  if (!permissions.some((permission) => roleCan(actor.role, permission))) {
    return { ok: false, result: { ok: false, errors: {}, message: 'ليست لديك صلاحية' } };
  }
  return { ok: true, value: { actor, trail: await requestContext() } };
}

function failure(error: unknown, log: Record<string, unknown>): ActionResult {
  if (error instanceof ValidationError) {
    // Wording chosen for the person reading the form.
    return { ok: false, errors: {}, message: error.message };
  }
  logger.error({ err: error, ...log }, 'customer write failed');
  return { ok: false, errors: {}, message: GENERIC };
}

/** Any of the three write permissions; the service still applies the scope. */
const WRITE_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.CUSTOMERS_WRITE_ALL,
  PERMISSIONS.CUSTOMERS_WRITE_OWN,
  PERMISSIONS.CUSTOMERS_CREATE,
];

function revalidateCustomers(): void {
  revalidatePath('/[locale]/admin/customers', 'page');
  revalidatePath('/[locale]/app/customers', 'page');
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createCustomerAction(
  _previous: ActionResult<{ temporaryPassword: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ temporaryPassword: string }>> {
  const access = await authorize(formData, [PERMISSIONS.CUSTOMERS_CREATE]);
  if (!access.ok) return access.result as ActionResult<{ temporaryPassword: string }>;

  const parsed = createSchema.safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    const created = await createCustomer(
      access.value.actor,
      {
        ...parsed.data,
        creditTerms: {
          paymentTerms: parsed.data.paymentTerms,
          creditLimit: parsed.data.creditLimit,
          creditDays: parsed.data.creditDays,
        },
      },
      access.value.trail,
    );
    revalidateCustomers();
    return { ok: true, data: { temporaryPassword: created.temporaryPassword } };
  } catch (error) {
    return failure(error, { entity: 'Customer' }) as ActionResult<{
      temporaryPassword: string;
    }>;
  }
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export async function updateCustomerAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData, WRITE_PERMISSIONS);
  if (!access.ok) return access.result;

  const parsed = updateSchema.safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  const { customerId, ...master } = parsed.data;
  try {
    await updateCustomer(access.value.actor, customerId, master, access.value.trail);
  } catch (error) {
    return failure(error, { entity: 'Customer' });
  }

  revalidateCustomers();
  return { ok: true, message: 'تم حفظ بيانات العميل' };
}

export async function updateCreditTermsAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData, [PERMISSIONS.CUSTOMERS_CREDIT_TERMS]);
  if (!access.ok) return access.result;

  const parsed = creditTermsSchema.safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await updateCreditTerms(
      access.value.actor,
      parsed.data.customerId,
      {
        paymentTerms: parsed.data.paymentTerms,
        creditLimit: parsed.data.creditLimit,
        creditDays: parsed.data.creditDays,
      },
      access.value.trail,
    );
  } catch (error) {
    return failure(error, { entity: 'Customer' });
  }

  revalidateCustomers();
  return { ok: true, message: 'تم حفظ شروط السداد' };
}

export async function setCustomerStatusAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData, [PERMISSIONS.CUSTOMERS_BLOCK]);
  if (!access.ok) return access.result;

  const parsed = statusSchema.safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await setCustomerStatus(
      access.value.actor,
      parsed.data.customerId,
      parsed.data.status as CustomerStatus,
      access.value.trail,
    );
  } catch (error) {
    return failure(error, { entity: 'Customer' });
  }

  revalidateCustomers();
  return { ok: true, message: 'تم تحديث حالة العميل' };
}

export async function reassignCustomerAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData, [PERMISSIONS.CUSTOMERS_ASSIGN_REP]);
  if (!access.ok) return access.result;

  const parsed = reassignSchema.safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await reassignCustomer(
      access.value.actor,
      parsed.data.customerId,
      parsed.data.repId,
      access.value.trail,
    );
  } catch (error) {
    return failure(error, { entity: 'CustomerRepAssignment' });
  }

  revalidateCustomers();
  return { ok: true, message: 'تم تغيير المندوب المسؤول' };
}

export async function deleteCustomerAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData, [PERMISSIONS.CUSTOMERS_WRITE_ALL]);
  if (!access.ok) return access.result;

  const parsed = idSchema.safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await deleteCustomer(access.value.actor, parsed.data.customerId, access.value.trail);
  } catch (error) {
    return failure(error, { entity: 'Customer' });
  }

  revalidateCustomers();
  return { ok: true, message: 'تم حذف العميل' };
}

// ---------------------------------------------------------------------------
// Customer categories
// ---------------------------------------------------------------------------

export async function createCustomerCategoryAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData, [PERMISSIONS.CUSTOMERS_WRITE_ALL]);
  if (!access.ok) return access.result;

  const parsed = categorySchema.safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await createCustomerCategory(access.value.actor, parsed.data, access.value.trail);
  } catch (error) {
    return failure(error, { entity: 'CustomerCategory' });
  }

  revalidateCustomers();
  return { ok: true, message: 'تمت إضافة التصنيف' };
}

export async function updateCustomerCategoryAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData, [PERMISSIONS.CUSTOMERS_WRITE_ALL]);
  if (!access.ok) return access.result;

  const parsed = categorySchema
    .extend({ categoryId: z.string().uuid('معرّف غير صالح') })
    .safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await updateCustomerCategory(
      access.value.actor,
      parsed.data.categoryId,
      { name: parsed.data.name, nameEn: parsed.data.nameEn },
      access.value.trail,
    );
  } catch (error) {
    return failure(error, { entity: 'CustomerCategory' });
  }

  revalidateCustomers();
  return { ok: true, message: 'تم حفظ التصنيف' };
}

export async function deleteCustomerCategoryAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData, [PERMISSIONS.CUSTOMERS_WRITE_ALL]);
  if (!access.ok) return access.result;

  const parsed = categoryIdSchema.safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await deleteCustomerCategory(access.value.actor, parsed.data.categoryId, access.value.trail);
  } catch (error) {
    return failure(error, { entity: 'CustomerCategory' });
  }

  revalidateCustomers();
  return { ok: true, message: 'تم حذف التصنيف' };
}
