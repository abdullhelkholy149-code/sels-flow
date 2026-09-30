/**
 * Company settings server action (Phase 1).
 *
 * Every field is written in one transaction with its audit row, so the log can
 * never disagree with the row it describes. The diff is computed against the
 * values read inside the same transaction, which keeps a concurrent edit from
 * producing a misleading before/after pair.
 */
'use server';

import { AuditAction } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { PERMISSIONS } from '@/lib/auth/permissions';
import { withTransaction } from '@/lib/prisma';
import { diffRecords, writeAudit } from '@/server/audit/service';
import type { ActionResult, FormErrors } from '@/server/auth/actions';
import { assertFormCsrf, CSRF_FIELD, getSessionUser } from '@/server/auth/session';
import { assertPermission, loadActor } from '@/server/data/access';
import { requestContext } from '@/server/http/request-context';
import { getCompanySettings, updateCompanySettings } from '@/server/settings/service';

const CSRF_MESSAGE = 'انتهت صلاحية الجلسة، حدّث الصفحة وحاول مرة أخرى';

/** A prefix is printed on a document, so it is kept short and printable. */
const prefix = z
  .string()
  .trim()
  .min(1, 'البادئة مطلوبة')
  .max(8, 'البادئة 8 أحرف على الأكثر')
  .regex(/^[A-Za-z0-9-]+$/, 'البادئة بحروف إنجليزية وأرقام فقط');

/** An empty text input means "not set", which the column stores as NULL. */
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => (value === '' ? null : value))
    .nullable();

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

const settingsSchema = z
  .object({
    legalName: z.string().trim().min(2, 'أدخل الاسم القانوني').max(160),
    taxRegistrationNumber: optionalText(40, 'رقم التسجيل طويل جداً'),
    branchCode: optionalText(20, 'كود الفرع طويل جداً'),
    activityCode: optionalText(20, 'كود النشاط طويل جداً'),
    address: optionalText(240, 'العنوان طويل جداً'),
    phone: optionalText(40, 'رقم الهاتف طويل جداً'),
    email: z
      .string()
      .trim()
      .max(160, 'البريد طويل جداً')
      .refine((value) => value === '' || /.+@.+\..+/.test(value), 'بريد إلكتروني غير صالح')
      .transform((value) => (value === '' ? null : value))
      .nullable(),
    defaultVatRate: z.coerce
      .number()
      .min(0, 'النسبة لا تقل عن 0')
      .max(100, 'النسبة لا تزيد عن 100')
      .refine((value) => Number.isInteger(value * 100), 'النسبة بمنزلتين عشريتين'),
    invoicePrefix: prefix,
    creditNotePrefix: prefix,
    orderPrefix: prefix,
    returnWindowDays: z.coerce
      .number()
      .int()
      .min(0, 'المدة لا تقل عن 0')
      .max(365, 'المدة سنة كحد أقصى'),
    blockOnOverdue: flag,
    overdueGraceDays: z.coerce
      .number()
      .int()
      .min(0, 'المهلة لا تقل عن 0')
      .max(90, 'المهلة 90 يوم كحد أقصى'),
    geofenceRadiusM: z.coerce
      .number()
      .int()
      .min(0, 'النطاق لا يقل عن 0')
      .max(5000, 'النطاق 5 كم كحد أقصى'),
    geofenceBlock: flag,
    defaultMaxDiscountPercent: z.coerce
      .number()
      .min(0, 'الخصم لا يقل عن 0')
      .max(100, 'الخصم لا يزيد عن 100'),
    whatsappEnabled: flag,
    defaultCreditDays: z.coerce
      .number()
      .int()
      .min(0, 'المدة لا تقل عن 0')
      .max(365, 'المدة سنة كحد أقصى'),
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

function payload(formData: FormData): Record<string, unknown> {
  return Object.fromEntries([...formData].filter(([key]) => key !== CSRF_FIELD));
}

export async function updateCompanySettingsAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await getSessionUser();
  try {
    await assertFormCsrf(formData, session);
  } catch {
    return { ok: false, errors: {}, message: CSRF_MESSAGE };
  }
  if (!session) return { ok: false, errors: {}, message: 'انتهت الجلسة' };

  const actor = await loadActor(session);
  try {
    assertPermission(actor, PERMISSIONS.SETTINGS_WRITE);
  } catch {
    return { ok: false, errors: {}, message: 'ليست لديك صلاحية' };
  }

  const parsed = settingsSchema.safeParse(payload(formData));
  if (!parsed.success) {
    return { ok: false, errors: flatten(parsed.error) };
  }

  const context = await requestContext();
  await withTransaction(async (tx) => {
    // Read and write inside one transaction, so the audit diff describes the
    // values this statement actually replaced.
    const current = await getCompanySettings(tx);
    const change = diffRecords(current, parsed.data);
    await updateCompanySettings(tx, parsed.data);
    await writeAudit(tx, {
      action: AuditAction.UPDATE,
      entityType: 'CompanySettings',
      entityId: '1',
      actorUserId: actor.userId,
      actorRole: actor.role,
      // A settings change is exactly the kind of quiet edit the log exists for,
      // so it carries who did it and from where, like every other action.
      ip: context.ip,
      userAgent: context.userAgent,
      before: change.before,
      after: change.after,
    });
  });

  revalidatePath('/[locale]/admin/settings', 'page');
  return { ok: true, message: 'تم حفظ إعدادات الشركة' };
}
