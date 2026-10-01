'use client';

/**
 * Customer forms (Phase 3).
 *
 * The master fields appear twice - once in the create form and once in the edit
 * form on the profile - so they are rendered by one component. Duplicating
 * fifteen `<Field>`s would let the two drift, and the drift would show up as a
 * field that is editable on one screen and read-only on the other.
 *
 * The two forms differ in exactly three fields, and the differences are the
 * point rather than an accident:
 *   - create asks for the rep and writes a login (rep + username + terms +
 *     opening balance); edit leaves all three alone, because they are history or
 *     money rules with their own screens.
 */
import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import {
  CsrfField,
  Field,
  FieldErrors,
  FormMessage,
  InlineSubmitButton,
  SelectField,
  SubmitButton,
  type ActionResult,
} from '@/components/ui/form';
import {
  createCustomerAction,
  deleteCustomerAction,
  reassignCustomerAction,
  setCustomerStatusAction,
  updateCreditTermsAction,
  updateCustomerAction,
} from '@/server/customers/actions';

export interface Option {
  value: string;
  label: string;
}

export interface CustomerDefaults {
  name?: string;
  tradeName?: string;
  contactPerson?: string;
  phone?: string;
  address?: string;
  governorate?: string;
  city?: string;
  categoryId?: string;
  priceListId?: string;
  receiverType?: string;
  taxRegistrationNumber?: string;
  nationalId?: string;
  notes?: string;
  whatsappOptIn?: boolean;
}

/** Categories and price lists are optional, so both get a "not set" option. */
function withBlank(options: Option[], label: string): Option[] {
  return [{ value: '', label }, ...options];
}

/**
 * The master fields, in the order an operator fills them.
 *
 * `id` is passed only by the edit form; the create form gets its row from the
 * service, never from the browser.
 */
function MasterFields({
  t,
  errors,
  defaults,
  categories,
  priceLists,
  id,
}: {
  t: ReturnType<typeof useTranslations<'customers'>>;
  errors: Record<string, string | undefined>;
  defaults: CustomerDefaults;
  categories: Option[];
  priceLists: Option[];
  id?: string;
}) {
  return (
    <>
      {id ? <input type="hidden" name="customerId" value={id} /> : null}
      <Field label={t('name')} name="name" error={errors.name} defaultValue={defaults.name} />
      <Field
        label={t('tradeName')}
        name="tradeName"
        required={false}
        error={errors.tradeName}
        defaultValue={defaults.tradeName}
      />
      <Field
        label={t('contactPerson')}
        name="contactPerson"
        required={false}
        error={errors.contactPerson}
        defaultValue={defaults.contactPerson}
      />
      <Field
        label={t('phone')}
        name="phone"
        type="tel"
        dir="ltr"
        inputMode="tel"
        error={errors.phone}
        defaultValue={defaults.phone}
      />
      <Field
        label={t('address')}
        name="address"
        required={false}
        error={errors.address}
        defaultValue={defaults.address}
      />
      <Field
        label={t('governorate')}
        name="governorate"
        required={false}
        error={errors.governorate}
        defaultValue={defaults.governorate}
      />
      <Field
        label={t('city')}
        name="city"
        required={false}
        error={errors.city}
        defaultValue={defaults.city}
      />
      <SelectField
        label={t('category')}
        name="categoryId"
        options={withBlank(categories, t('allCategories'))}
        defaultValue={defaults.categoryId ?? ''}
        error={errors.categoryId}
      />
      <SelectField
        label={t('priceList')}
        name="priceListId"
        options={withBlank(priceLists, t('allCategories'))}
        defaultValue={defaults.priceListId ?? ''}
        error={errors.priceListId}
      />
      <SelectField
        label={t('receiverType')}
        name="receiverType"
        options={[
          { value: 'BUSINESS', label: t('receiverBusiness') },
          { value: 'PERSON', label: t('receiverPerson') },
          { value: 'FOREIGN', label: t('receiverForeign') },
        ]}
        defaultValue={defaults.receiverType ?? 'BUSINESS'}
        error={errors.receiverType}
      />
      <Field
        label={t('taxRegistrationNumber')}
        name="taxRegistrationNumber"
        required={false}
        dir="ltr"
        error={errors.taxRegistrationNumber}
        defaultValue={defaults.taxRegistrationNumber}
      />
      <Field
        label={t('nationalId')}
        name="nationalId"
        required={false}
        dir="ltr"
        error={errors.nationalId}
        defaultValue={defaults.nationalId}
      />
      <SelectField
        label={t('whatsappOptIn')}
        name="whatsappOptIn"
        options={[
          { value: 'false', label: t('inactive') },
          { value: 'true', label: t('active') },
        ]}
        defaultValue={defaults.whatsappOptIn ? 'true' : 'false'}
        error={errors.whatsappOptIn}
      />
      <Field
        label={t('notes')}
        name="notes"
        required={false}
        error={errors.notes}
        defaultValue={defaults.notes}
      />
    </>
  );
}

/**
 * Shown once, after a successful create.
 *
 * The password is never stored in readable form, so it cannot be shown again -
 * only reissued through the reset flow. That is why this is a notice rather than
 * a field the admin can come back to.
 */
function TemporaryPassword({ password }: { password: string }) {
  const t = useTranslations('customers');
  return (
    <div className="rounded-card border border-warning bg-warning-soft p-3 text-sm">
      <p className="font-medium text-warning">{t('temporaryPasswordTitle')}</p>
      <p dir="ltr" className="my-1 font-mono text-base text-ink">
        {password}
      </p>
      <p className="text-xs text-ink-muted">{t('temporaryPasswordHint')}</p>
    </div>
  );
}

export function CreateCustomerForm({
  reps,
  categories,
  priceLists,
  defaultRepId,
}: {
  reps: Option[];
  categories: Option[];
  priceLists: Option[];
  /** A rep's own form pre-selects himself; an office form leaves it empty. */
  defaultRepId?: string;
}) {
  const t = useTranslations('customers');
  const [state, formAction] = useActionState(createCustomerAction, null);
  const errors = state && !state.ok ? state.errors : {};

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <CsrfField />
      <FieldErrors errors={errors} />
      {state?.ok && state.data ? (
        <TemporaryPassword password={state.data.temporaryPassword} />
      ) : null}
      <MasterFields
        t={t}
        errors={errors}
        defaults={{}}
        categories={categories}
        priceLists={priceLists}
      />
      <SelectField
        label={t('rep')}
        name="repId"
        options={reps}
        defaultValue={defaultRepId ?? ''}
        error={errors.repId}
      />
      <Field
        label={t('username')}
        name="username"
        required={false}
        dir="ltr"
        autoComplete="off"
        error={errors.username}
      />
      <SelectField
        label={t('paymentTerms')}
        name="paymentTerms"
        options={[
          { value: 'CASH', label: t('cash') },
          { value: 'CREDIT', label: t('credit') },
        ]}
        defaultValue="CASH"
        error={errors.paymentTerms}
      />
      <Field
        label={t('creditLimit')}
        name="creditLimit"
        type="text"
        inputMode="decimal"
        dir="ltr"
        required={false}
        defaultValue="0"
        error={errors.creditLimit}
      />
      <Field
        label={t('creditDays')}
        name="creditDays"
        type="text"
        inputMode="numeric"
        dir="ltr"
        required={false}
        defaultValue="0"
        error={errors.creditDays}
      />
      <Field
        label={t('openingBalance')}
        name="openingBalance"
        type="text"
        inputMode="decimal"
        dir="ltr"
        required={false}
        defaultValue="0"
        error={errors.openingBalance}
      />
      <p className="text-xs text-ink-subtle">{t('openingBalanceHint')}</p>
      <FormMessage result={state} />
      <SubmitButton className="w-full">{t('addCustomer')}</SubmitButton>
    </form>
  );
}

export function EditCustomerForm({
  customerId,
  defaults,
  categories,
  priceLists,
}: {
  customerId: string;
  defaults: CustomerDefaults;
  categories: Option[];
  priceLists: Option[];
}) {
  const t = useTranslations('customers');
  const [state, formAction] = useActionState(updateCustomerAction, null);
  const errors = state && !state.ok ? state.errors : {};

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <CsrfField />
      <FieldErrors errors={errors} />
      <MasterFields
        t={t}
        errors={errors}
        defaults={defaults}
        categories={categories}
        priceLists={priceLists}
        id={customerId}
      />
      <FormMessage result={state} />
      <SubmitButton className="w-full">{t('saveChanges')}</SubmitButton>
    </form>
  );
}

export function CreditTermsForm({
  customerId,
  paymentTerms,
  creditLimit,
  creditDays,
}: {
  customerId: string;
  paymentTerms: string;
  creditLimit: string;
  creditDays: number;
}) {
  const t = useTranslations('customers');
  const [state, formAction] = useActionState(updateCreditTermsAction, null);
  const errors = state && !state.ok ? state.errors : {};

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <CsrfField />
      <input type="hidden" name="customerId" value={customerId} />
      <FieldErrors errors={errors} />
      <SelectField
        label={t('paymentTerms')}
        name="paymentTerms"
        options={[
          { value: 'CASH', label: t('cash') },
          { value: 'CREDIT', label: t('credit') },
        ]}
        defaultValue={paymentTerms}
        error={errors.paymentTerms}
      />
      <Field
        label={t('creditLimit')}
        name="creditLimit"
        type="text"
        inputMode="decimal"
        dir="ltr"
        required={false}
        defaultValue={creditLimit}
        error={errors.creditLimit}
      />
      <Field
        label={t('creditDays')}
        name="creditDays"
        type="text"
        inputMode="numeric"
        dir="ltr"
        required={false}
        defaultValue={String(creditDays)}
        error={errors.creditDays}
      />
      <FormMessage result={state} />
      <SubmitButton variant="secondary">{t('creditTermsTitle')}</SubmitButton>
    </form>
  );
}

/**
 * Reassignment, as its own form rather than an edit of the customer row.
 *
 * The assignment is history, so it is appended to rather than overwritten: this
 * form names a new rep and the service closes the old open row.
 */
export function ReassignRepForm({ customerId, reps }: { customerId: string; reps: Option[] }) {
  const t = useTranslations('customers');
  const [state, formAction] = useActionState(reassignCustomerAction, null);
  const errors = state && !state.ok ? state.errors : {};

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <CsrfField />
      <input type="hidden" name="customerId" value={customerId} />
      <FieldErrors errors={errors} />
      <SelectField label={t('rep')} name="repId" options={reps} error={errors.repId} />
      <FormMessage result={state} />
      <SubmitButton variant="secondary">{t('reassign')}</SubmitButton>
    </form>
  );
}

/**
 * Blocking and deleting, the two destructive controls.
 *
 * Both are inline buttons rather than a form per row: they act on the customer
 * in the row they sit in, and a full form per row would put four inputs in every
 * row of the table.
 */
export function CustomerRowActions({
  customerId,
  status,
  canBlock,
  canDelete,
}: {
  customerId: string;
  status: string;
  canBlock: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations('customers');
  const [blockState, blockAction] = useActionState(setCustomerStatusAction, null);
  const [deleteState, deleteAction] = useActionState(deleteCustomerAction, null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canBlock ? (
        <form action={blockAction}>
          <CsrfField />
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="status" value={status === 'BLOCKED' ? 'ACTIVE' : 'BLOCKED'} />
          <InlineSubmitButton variant="secondary">
            {status === 'BLOCKED' ? t('unblock') : t('block')}
          </InlineSubmitButton>
        </form>
      ) : null}
      {canDelete ? (
        <form action={deleteAction}>
          <CsrfField />
          <input type="hidden" name="customerId" value={customerId} />
          <InlineSubmitButton variant="danger">{t('delete')}</InlineSubmitButton>
        </form>
      ) : null}
      {blockState?.ok ? <span className="text-xs text-success">{blockState.message}</span> : null}
      {deleteState?.ok ? <span className="text-xs text-success">{deleteState.message}</span> : null}
    </div>
  );
}

/** The type the page and the form agree on, kept in one place. */
export type CustomerActionResult = ActionResult;
