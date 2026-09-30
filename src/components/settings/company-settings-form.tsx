'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import { CsrfField, Field, FieldErrors, FormMessage, SubmitButton } from '@/components/ui/form';
import { updateCompanySettingsAction } from '@/server/settings/actions';
import type { CompanySettings } from '@/server/settings/service';

/**
 * An unchecked checkbox posts nothing at all, and the schema requires every
 * flag, so the hidden input is what carries `false`. The checkbox follows it, so
 * a ticked box is the later value and wins when the form is read.
 */
function Flag({
  name,
  label,
  defaultChecked,
  hint,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2.5">
      <input type="hidden" name={name} value="false" />
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 rounded border-surface-border"
      />
      <span className="flex flex-col">
        <span className="text-sm text-ink">{label}</span>
        {hint ? <span className="text-xs text-ink-subtle">{hint}</span> : null}
      </span>
    </label>
  );
}

export function CompanySettingsForm({ settings }: { settings: CompanySettings }) {
  const t = useTranslations('settings');
  const [state, formAction] = useActionState(updateCompanySettingsAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <CsrfField />
      <FieldErrors errors={state && !state.ok ? state.errors : {}} />

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-ink">{t('identityTitle')}</legend>
        <Field label={t('legalName')} name="legalName" defaultValue={settings.legalName} />
        <Field
          label={t('taxRegistrationNumber')}
          name="taxRegistrationNumber"
          required={false}
          defaultValue={settings.taxRegistrationNumber ?? ''}
        />
        <Field
          label={t('branchCode')}
          name="branchCode"
          required={false}
          defaultValue={settings.branchCode ?? ''}
        />
        <Field
          label={t('activityCode')}
          name="activityCode"
          required={false}
          defaultValue={settings.activityCode ?? ''}
        />
        <Field
          label={t('address')}
          name="address"
          required={false}
          defaultValue={settings.address ?? ''}
        />
        <Field
          label={t('phone')}
          name="phone"
          type="tel"
          required={false}
          dir="ltr"
          defaultValue={settings.phone ?? ''}
        />
        <Field
          label={t('email')}
          name="email"
          type="email"
          required={false}
          dir="ltr"
          defaultValue={settings.email ?? ''}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-ink">{t('documentsTitle')}</legend>
        <Field
          label={t('invoicePrefix')}
          name="invoicePrefix"
          dir="ltr"
          defaultValue={settings.invoicePrefix}
        />
        <Field
          label={t('creditNotePrefix')}
          name="creditNotePrefix"
          dir="ltr"
          defaultValue={settings.creditNotePrefix}
        />
        <Field
          label={t('orderPrefix')}
          name="orderPrefix"
          dir="ltr"
          defaultValue={settings.orderPrefix}
        />
        <Field
          label={t('defaultVatRate')}
          name="defaultVatRate"
          type="number"
          inputMode="decimal"
          defaultValue={String(settings.defaultVatRate)}
        />
        <Field
          label={t('defaultMaxDiscountPercent')}
          name="defaultMaxDiscountPercent"
          type="number"
          inputMode="decimal"
          defaultValue={String(settings.defaultMaxDiscountPercent)}
        />
        <Field
          label={t('returnWindowDays')}
          name="returnWindowDays"
          type="number"
          inputMode="numeric"
          defaultValue={String(settings.returnWindowDays)}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-ink">{t('creditTitle')}</legend>
        <Field
          label={t('defaultCreditDays')}
          name="defaultCreditDays"
          type="number"
          inputMode="numeric"
          defaultValue={String(settings.defaultCreditDays)}
        />
        <Field
          label={t('overdueGraceDays')}
          name="overdueGraceDays"
          type="number"
          inputMode="numeric"
          defaultValue={String(settings.overdueGraceDays)}
        />
        <Flag
          name="blockOnOverdue"
          label={t('blockOnOverdue')}
          hint={t('blockOnOverdueHint')}
          defaultChecked={settings.blockOnOverdue}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-ink">{t('visitsTitle')}</legend>
        <Field
          label={t('geofenceRadiusM')}
          name="geofenceRadiusM"
          type="number"
          inputMode="numeric"
          defaultValue={String(settings.geofenceRadiusM)}
        />
        <Flag
          name="geofenceBlock"
          label={t('geofenceBlock')}
          hint={t('geofenceBlockHint')}
          defaultChecked={settings.geofenceBlock}
        />
        <Flag
          name="whatsappEnabled"
          label={t('whatsappEnabled')}
          defaultChecked={settings.whatsappEnabled}
        />
      </fieldset>

      <FormMessage result={state} />
      <SubmitButton className="self-start">{t('save')}</SubmitButton>
    </form>
  );
}
