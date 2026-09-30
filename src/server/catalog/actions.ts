/**
 * Catalog and pricing server actions (Phase 2).
 *
 * The four steps every action in this project follows, in this order:
 *   1. Zod `.strict()` parse, so an unknown field is an error (Section 8)
 *   2. CSRF and session check
 *   3. the business rule, inside one transaction
 *   4. an audit row committed with the change (in `service.ts`)
 *
 * Arabic messages, no technical detail, no stack traces. `ValidationError` from
 * the service carries the wording the reader should see, and everything else
 * falls back to a generic message that goes to the log rather than to the form.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { logger } from '@/lib/logger';
import { Decimal } from '@/lib/format';
import { PERMISSIONS } from '@/lib/auth/permissions';
import type { ActionResult, FormErrors } from '@/server/auth/actions';
import { assertFormCsrf, CSRF_FIELD, getSessionUser } from '@/server/auth/session';
import { assertPermission, loadActor, ValidationError, type Actor } from '@/server/data/access';
import { requestContext } from '@/server/http/request-context';
import { parseDateInput } from '@/server/catalog/pricing';
import {
  createPriceList,
  createPriceListItem,
  createProduct,
  createProductCategory,
  createUnit,
  deletePriceList,
  deletePriceListItem,
  deleteProduct,
  deleteProductCategory,
  deleteUnit,
  setProductActive,
  updatePriceList,
  updatePriceListItem,
  updateProduct,
  updateProductCategory,
  updateUnit,
  type PriceItemInput,
  type PriceItemWindowInput,
  type ProductInput,
} from '@/server/catalog/service';

const GENERIC = 'تعذّر حفظ البيانات، حاول مرة أخرى';

/** The 14% of a product, validated to hundredths and to a sane range. */
const percent = z.coerce
  .number()
  .min(0, 'النسبة لا تقل عن 0')
  .max(100, 'النسبة لا تزيد عن 100')
  .refine((value) => Number.isInteger(value * 100), 'النسبة بمنزلتين عشريتين');

/** An empty text input means "not set", which the column stores as NULL. */
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => (value === '' ? null : value))
    .nullable();

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

/** NUMERIC(14,2) is the column, so anything larger is refused before the write. */
const MAX_MONEY = new Decimal('999999999999.99');

/**
 * `new Decimal('مجانا')` throws, and a throw inside `.transform()` escapes
 * `safeParse` and surfaces as a 500 instead of a field error. So the conversion,
 * the sign check and the range check all happen here and are reported as issues.
 * A later `.refine()` is deliberately avoided: once a transform has added an
 * issue it hands `z.NEVER` to whatever follows, and calling a method on that
 * symbol throws again, which is the very thing this function exists to prevent.
 */
function toDecimal(
  value: string,
  ctx: z.RefinementCtx,
  rules: { invalid: string; positive: string; max?: string },
): Decimal {
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: rules.invalid });
    return z.NEVER;
  }
  if (!parsed.isFinite()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: rules.invalid });
    return z.NEVER;
  }
  if (!parsed.isPositive()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: rules.positive });
    return z.NEVER;
  }
  if (rules.max !== undefined && parsed.abs().greaterThan(MAX_MONEY)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: rules.max });
    return z.NEVER;
  }
  return parsed;
}

const nameSchema = (max: number, message: string) => z.string().trim().min(1, message).max(max);

const categorySchema = z
  .object({
    name: nameSchema(80, 'اسم الفئة مطلوب'),
    nameEn: optionalText(80, 'الاسم بالإنجليزية طويل جداً'),
  })
  .strict();

const unitSchema = z
  .object({
    name: nameSchema(40, 'اسم الوحدة مطلوب'),
    nameEn: optionalText(40, 'الاسم بالإنجليزية طويل جداً'),
  })
  .strict();

const productSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, 'كود المنتج مطلوب')
      .max(40)
      .regex(/^[A-Za-z0-9._-]+$/, 'الكود بحروف إنجليزية وأرقام فقط'),
    nameAr: nameSchema(160, 'اسم المنتج مطلوب'),
    nameEn: optionalText(160, 'الاسم بالإنجليزية طويل جداً'),
    categoryId: z.string().uuid('اختر فئة صحيحة'),
    unitId: z.string().uuid('اختر وحدة صحيحة'),
    packSize: z
      .string()
      .trim()
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .optional()
      .transform((value, ctx) =>
        value === null || value === undefined
          ? null
          : toDecimal(value, ctx, {
              invalid: 'حجم العبوة غير صالح',
              positive: 'حجم العبوة يجب أن يكون أكبر من صفر',
            }),
      ),
    vatRate: percent,
    costPrice: z
      .string()
      .trim()
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .optional()
      .transform((value, ctx) =>
        value === null || value === undefined
          ? null
          : toDecimal(value, ctx, {
              invalid: 'سعر التكلفة غير صالح',
              positive: 'سعر التكلفة يجب أن يكون أكبر من صفر',
            }),
      ),
    isActive: flag.default('true'),
  })
  .strict();

const productIdSchema = z.object({ productId: z.string().uuid('معرّف غير صالح') }).strict();

const priceListSchema = z
  .object({
    name: nameSchema(80, 'اسم قائمة الأسعار مطلوب'),
    nameEn: optionalText(80, 'الاسم بالإنجليزية طويل جداً'),
  })
  .strict();

/**
 * Prices are exclusive of VAT (Section 5.2), so a zero price is not a gift, it
 * is a mistake: the line would be issued at no cost. Rejected rather than
 * allowed and discovered on the invoice.
 */
const money = z
  .string()
  .trim()
  .min(1, 'السعر مطلوب')
  .transform((value, ctx) =>
    toDecimal(value, ctx, {
      invalid: 'السعر غير صالح',
      positive: 'السعر يجب أن يكون أكبر من صفر',
      max: 'السعر أكبر من الحد المسموح',
    }),
  );

const priceItemSchema = z
  .object({
    priceListId: z.string().uuid('قائمة الأسعار غير صالحة'),
    productId: z.string().uuid('المنتج غير صالح'),
    price: money,
    validFrom: z.string().trim().min(1, 'تاريخ بداية الصلاحية مطلوب'),
    validTo: z
      .string()
      .trim()
      .transform((value) => (value === '' ? null : value))
      .nullable(),
  })
  .strict();

/** An edit touches the value and the window, never which product or list. */
const priceItemUpdateSchema = z
  .object({
    priceItemId: z.string().uuid('معرّف غير صالح'),
    price: money,
    validFrom: z.string().trim().min(1, 'تاريخ بداية الصلاحية مطلوب'),
    validTo: z
      .string()
      .trim()
      .transform((value) => (value === '' ? null : value))
      .nullable(),
  })
  .strict();

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

/**
 * Steps 2 and the permission check, shared by every action here so a new screen
 * cannot forget the CSRF check by forgetting to copy it.
 */
async function authorize(
  formData: FormData,
  permission: typeof PERMISSIONS.CATALOG_WRITE | typeof PERMISSIONS.PRICING_WRITE,
): Promise<
  | { ok: true; actor: Actor; trail: { ip: string | null; userAgent: string | null } }
  | {
      ok: false;
      result: ActionResult;
    }
> {
  const session = await getSessionUser();
  try {
    await assertFormCsrf(formData, session);
  } catch {
    return {
      ok: false,
      result: { ok: false, errors: {}, message: 'انتهت صلاحية الجلسة، حدّث الصفحة وحاول مرة أخرى' },
    };
  }
  if (!session) return { ok: false, result: { ok: false, errors: {}, message: 'انتهت الجلسة' } };

  const actor = await loadActor(session);
  try {
    assertPermission(actor, permission);
  } catch {
    return { ok: false, result: { ok: false, errors: {}, message: 'ليست لديك صلاحية' } };
  }

  return { ok: true, actor, trail: await requestContext() };
}

function failure(error: unknown, log: Record<string, unknown>): ActionResult {
  if (error instanceof ValidationError) {
    // Wording chosen for the person reading the form.
    return { ok: false, errors: {}, message: error.message };
  }
  logger.error({ err: error, ...log }, 'catalog write failed');
  return { ok: false, errors: {}, message: GENERIC };
}

/**
 * The shared shape of a delete action: same authorisation, same id parse, same
 * failure wording. Only the permission and the revalidated path differ, so each
 * action below is four lines rather than a copy of the whole pipeline.
 */
async function deleteAction(
  formData: FormData,
  permission: typeof PERMISSIONS.CATALOG_WRITE | typeof PERMISSIONS.PRICING_WRITE,
  path: string,
  run: (
    actor: Actor,
    id: string,
    trail: { ip: string | null; userAgent: string | null },
  ) => Promise<void>,
  entity: string,
): Promise<ActionResult> {
  const access = await authorize(formData, permission);
  if (!access.ok) return access.result;

  const parsed = productIdSchema.safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await run(access.actor, parsed.data.productId, access.trail);
  } catch (error) {
    return failure(error, { entity });
  }

  revalidatePath(path, 'page');
  return { ok: true, message: 'تم الحذف' };
}

// ---------------------------------------------------------------------------
// Categories and units
// ---------------------------------------------------------------------------

export async function createCategoryAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData, PERMISSIONS.CATALOG_WRITE);
  if (!access.ok) return access.result;

  const parsed = categorySchema.safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await createProductCategory(
      access.actor,
      { name: parsed.data.name, nameEn: parsed.data.nameEn },
      access.trail,
    );
  } catch (error) {
    return failure(error, { entity: 'ProductCategory' });
  }

  revalidatePath('/[locale]/admin/products', 'page');
  return { ok: true, message: 'تمت إضافة الفئة' };
}

export async function createUnitAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData, PERMISSIONS.CATALOG_WRITE);
  if (!access.ok) return access.result;

  const parsed = unitSchema.safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await createUnit(
      access.actor,
      { name: parsed.data.name, nameEn: parsed.data.nameEn },
      access.trail,
    );
  } catch (error) {
    return failure(error, { entity: 'Unit' });
  }

  revalidatePath('/[locale]/admin/products', 'page');
  return { ok: true, message: 'تمت إضافة الوحدة' };
}

export async function updateCategoryAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData, PERMISSIONS.CATALOG_WRITE);
  if (!access.ok) return access.result;

  const parsed = categorySchema
    .extend({ categoryId: z.string().uuid('معرّف غير صالح') })
    .safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await updateProductCategory(
      access.actor,
      parsed.data.categoryId,
      { name: parsed.data.name, nameEn: parsed.data.nameEn },
      access.trail,
    );
  } catch (error) {
    return failure(error, { entity: 'ProductCategory' });
  }

  revalidatePath('/[locale]/admin/products', 'page');
  return { ok: true, message: 'تم حفظ الفئة' };
}

export async function deleteCategoryAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return deleteAction(
    formData,
    PERMISSIONS.CATALOG_WRITE,
    '/[locale]/admin/products',
    deleteProductCategory,
    'ProductCategory',
  );
}

export async function updateUnitAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData, PERMISSIONS.CATALOG_WRITE);
  if (!access.ok) return access.result;

  const parsed = unitSchema
    .extend({ unitId: z.string().uuid('معرّف غير صالح') })
    .safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await updateUnit(
      access.actor,
      parsed.data.unitId,
      { name: parsed.data.name, nameEn: parsed.data.nameEn },
      access.trail,
    );
  } catch (error) {
    return failure(error, { entity: 'Unit' });
  }

  revalidatePath('/[locale]/admin/products', 'page');
  return { ok: true, message: 'تم حفظ الوحدة' };
}

export async function deleteUnitAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return deleteAction(
    formData,
    PERMISSIONS.CATALOG_WRITE,
    '/[locale]/admin/products',
    deleteUnit,
    'Unit',
  );
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

function toProductInput(data: z.infer<typeof productSchema>): ProductInput {
  return {
    code: data.code,
    nameAr: data.nameAr,
    nameEn: data.nameEn,
    categoryId: data.categoryId,
    unitId: data.unitId,
    packSize: data.packSize,
    vatRate: new Decimal(data.vatRate),
    costPrice: data.costPrice,
    isActive: data.isActive,
  };
}

export async function createProductAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData, PERMISSIONS.CATALOG_WRITE);
  if (!access.ok) return access.result;

  const parsed = productSchema.safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await createProduct(access.actor, toProductInput(parsed.data), access.trail);
  } catch (error) {
    return failure(error, { entity: 'Product' });
  }

  revalidatePath('/[locale]/admin/products', 'page');
  return { ok: true, message: 'تمت إضافة المنتج' };
}

export async function updateProductAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData, PERMISSIONS.CATALOG_WRITE);
  if (!access.ok) return access.result;

  const withId = productSchema.extend({ productId: z.string().uuid('معرّف غير صالح') });
  const parsed = withId.safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await updateProduct(
      access.actor,
      parsed.data.productId,
      toProductInput(parsed.data),
      access.trail,
    );
  } catch (error) {
    return failure(error, { entity: 'Product' });
  }

  revalidatePath('/[locale]/admin/products', 'page');
  return { ok: true, message: 'تم حفظ المنتج' };
}

export async function setProductActiveAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData, PERMISSIONS.CATALOG_WRITE);
  if (!access.ok) return access.result;

  const parsed = productIdSchema.extend({ isActive: flag }).safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await setProductActive(access.actor, parsed.data.productId, parsed.data.isActive, access.trail);
  } catch (error) {
    return failure(error, { entity: 'Product' });
  }

  revalidatePath('/[locale]/admin/products', 'page');
  return { ok: true, message: 'تم تحديث حالة المنتج' };
}

export async function deleteProductAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return deleteAction(
    formData,
    PERMISSIONS.CATALOG_WRITE,
    '/[locale]/admin/products',
    deleteProduct,
    'Product',
  );
}

// ---------------------------------------------------------------------------
// Price lists
// ---------------------------------------------------------------------------

export async function createPriceListAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData, PERMISSIONS.PRICING_WRITE);
  if (!access.ok) return access.result;

  const parsed = priceListSchema.safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await createPriceList(
      access.actor,
      { name: parsed.data.name, nameEn: parsed.data.nameEn },
      access.trail,
    );
  } catch (error) {
    return failure(error, { entity: 'PriceList' });
  }

  revalidatePath('/[locale]/admin/price-lists', 'page');
  return { ok: true, message: 'تمت إضافة قائمة الأسعار' };
}

export async function updatePriceListAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData, PERMISSIONS.PRICING_WRITE);
  if (!access.ok) return access.result;

  const parsed = priceListSchema
    .extend({ priceListId: z.string().uuid('معرّف غير صالح') })
    .safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await updatePriceList(
      access.actor,
      parsed.data.priceListId,
      { name: parsed.data.name, nameEn: parsed.data.nameEn },
      access.trail,
    );
  } catch (error) {
    return failure(error, { entity: 'PriceList' });
  }

  revalidatePath('/[locale]/admin/price-lists', 'page');
  return { ok: true, message: 'تم حفظ قائمة الأسعار' };
}

export async function deletePriceListAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return deleteAction(
    formData,
    PERMISSIONS.PRICING_WRITE,
    '/[locale]/admin/price-lists',
    deletePriceList,
    'PriceList',
  );
}

/**
 * Validates the window as dates before the service sees it, so an impossible
 * date is a form error rather than a row that quietly starts on another day.
 */
function toPriceItemInput(data: z.infer<typeof priceItemSchema>): PriceItemInput {
  const validFrom = parseDateInput(data.validFrom);
  if (!validFrom) throw new ValidationError('تاريخ بداية الصلاحية غير صالح');

  const validTo = data.validTo === null ? null : parseDateInput(data.validTo);
  if (data.validTo !== null && !validTo) {
    throw new ValidationError('تاريخ نهاية الصلاحية غير صالح');
  }
  if (validTo && validTo < validFrom) {
    throw new ValidationError('تاريخ النهاية قبل تاريخ البداية');
  }

  return {
    priceListId: data.priceListId,
    productId: data.productId,
    price: data.price,
    validFrom,
    validTo,
  };
}

export async function createPriceListItemAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData, PERMISSIONS.PRICING_WRITE);
  if (!access.ok) return access.result;

  const parsed = priceItemSchema.safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await createPriceListItem(access.actor, toPriceItemInput(parsed.data), access.trail);
  } catch (error) {
    return failure(error, { entity: 'PriceListItem' });
  }

  revalidatePath('/[locale]/admin/price-lists', 'page');
  return { ok: true, message: 'تمت إضافة السعر' };
}

/** The same date checks as creation, minus the two fields an edit cannot move. */
function toPriceItemWindowInput(data: z.infer<typeof priceItemUpdateSchema>): PriceItemWindowInput {
  const validFrom = parseDateInput(data.validFrom);
  if (!validFrom) throw new ValidationError('تاريخ بداية الصلاحية غير صالح');

  const validTo = data.validTo === null ? null : parseDateInput(data.validTo);
  if (data.validTo !== null && !validTo) {
    throw new ValidationError('تاريخ نهاية الصلاحية غير صالح');
  }
  if (validTo && validTo < validFrom) {
    throw new ValidationError('تاريخ النهاية قبل تاريخ البداية');
  }

  return { price: data.price, validFrom, validTo };
}

export async function updatePriceListItemAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const access = await authorize(formData, PERMISSIONS.PRICING_WRITE);
  if (!access.ok) return access.result;

  const parsed = priceItemUpdateSchema.safeParse(payload(formData));
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };

  try {
    await updatePriceListItem(
      access.actor,
      parsed.data.priceItemId,
      toPriceItemWindowInput(parsed.data),
      access.trail,
    );
  } catch (error) {
    return failure(error, { entity: 'PriceListItem' });
  }

  revalidatePath('/[locale]/admin/price-lists', 'page');
  return { ok: true, message: 'تم حفظ السعر' };
}

export async function deletePriceListItemAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return deleteAction(
    formData,
    PERMISSIONS.PRICING_WRITE,
    '/[locale]/admin/price-lists',
    deletePriceListItem,
    'PriceListItem',
  );
}
