'use client';

/**
 * Rep forms (Phase 3).
 *
 * A rep is created with a login in the same action, so this form shows the
 * temporary password once on success - the same contract as a customer, and for
 * the same reason: the hash is one-way, so the value cannot be shown again and
 * only reissued through the reset flow.
 */
import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import {
  CsrfField,
  Field,
  FieldErrors,
  FormMessage,
  InlineSubmitButton,
  SubmitButton,
} from '@/components/ui/form';
import {
  createRepAction,
  deleteRepAction,
  setRepActiveAction,
  updateRepAction,
} from '@/server/reps/actions';

function TemporaryPassword({ password }: { password: string }) {
  const t = useTranslations('reps');
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

export function CreateRepForm() {
  const t = useTranslations('reps');
  const [state, formAction] = useActionState(createRepAction, null);
  const errors = state && !state.ok ? state.errors : {};

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <CsrfField />
      <FieldErrors errors={errors} />
      {state?.ok && state.data ? (
        <TemporaryPassword password={state.data.temporaryPassword} />
      ) : null}
      <Field label={t('name')} name="name" autoComplete="off" error={errors.name} />
      <Field
        label={t('phone')}
        name="phone"
        type="tel"
        dir="ltr"
        inputMode="tel"
        autoComplete="off"
        error={errors.phone}
      />
      <Field
        label={t('username')}
        name="username"
        required={false}
        dir="ltr"
        autoComplete="off"
        error={errors.username}
      />
      <Field
        label={t('maxDiscountPercent')}
        name="maxDiscountPercent"
        type="text"
        inputMode="decimal"
        dir="ltr"
        required={false}
        defaultValue="0"
        error={errors.maxDiscountPercent}
      />
      <Field
        label={t('hiredAt')}
        name="hiredAt"
        type="date"
        dir="ltr"
        required={false}
        error={errors.hiredAt}
      />
      <FormMessage result={state} />
      <SubmitButton className="w-full">{t('addRep')}</SubmitButton>
    </form>
  );
}

/**
 * Edit a rep's master fields in place.
 *
 * A `<details>` per row rather than a separate page: the fields are five, the
 * screen is already a table, and a full page per rep would be a route whose only
 * content is a form.
 *
 * The phone and username are edited here *because* they are the login, and the
 * service writes both the rep record and the account in one transaction. Leaving
 * them out of this form would have been the quieter bug: the office changes a
 * number, the login does not.
 */
export function EditRepForm({
  repId,
  name,
  phone,
  username,
  maxDiscountPercent,
  hiredAt,
}: {
  repId: string;
  name: string;
  phone: string;
  username: string | null;
  maxDiscountPercent: string;
  hiredAt: string;
}) {
  const t = useTranslations('reps');
  const [state, formAction] = useActionState(updateRepAction, null);
  const errors = state && !state.ok ? state.errors : {};

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <CsrfField />
      <input type="hidden" name="repId" value={repId} />
      <FieldErrors errors={errors} />
      <Field label={t('name')} name="name" defaultValue={name} error={errors.name} />
      <Field
        label={t('phone')}
        name="phone"
        type="tel"
        dir="ltr"
        inputMode="tel"
        defaultValue={phone}
        error={errors.phone}
      />
      <Field
        label={t('username')}
        name="username"
        required={false}
        dir="ltr"
        defaultValue={username ?? ''}
        error={errors.username}
      />
      <Field
        label={t('maxDiscountPercent')}
        name="maxDiscountPercent"
        type="text"
        inputMode="decimal"
        dir="ltr"
        required={false}
        defaultValue={maxDiscountPercent}
        error={errors.maxDiscountPercent}
      />
      <Field
        label={t('hiredAt')}
        name="hiredAt"
        type="date"
        dir="ltr"
        required={false}
        defaultValue={hiredAt}
        error={errors.hiredAt}
      />
      <FormMessage result={state} />
      <SubmitButton variant="secondary">{t('save')}</SubmitButton>
    </form>
  );
}

/**
 * Switch a rep on or off.
 *
 * The wording on the button is "switch off" rather than "delete" because the
 * account survives: his history stays attached to the documents he wrote, and
 * only the login dies.
 */
export function RepActiveToggleButton({ repId, isActive }: { repId: string; isActive: boolean }) {
  const t = useTranslations('reps');
  const [state, formAction] = useActionState(setRepActiveAction, null);

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <CsrfField />
      <input type="hidden" name="repId" value={repId} />
      <input type="hidden" name="isActive" value={isActive ? 'false' : 'true'} />
      <InlineSubmitButton variant="secondary">
        {isActive ? t('deactivate') : t('activate')}
      </InlineSubmitButton>
      {state?.ok ? <span className="text-xs text-success">{state.message}</span> : null}
    </form>
  );
}

/**
 * Delete is offered only when the rep owns nobody.
 *
 * The count comes from the same query the service checks, so the button and the
 * rule agree; the service still re-checks inside the transaction, because the
 * button reflects a moment and the write happens later.
 */
export function RepDeleteButton({
  repId,
  customerCount,
}: {
  repId: string;
  customerCount: number;
}) {
  const t = useTranslations('reps');
  const [state, formAction] = useActionState(deleteRepAction, null);

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <CsrfField />
      <input type="hidden" name="repId" value={repId} />
      <InlineSubmitButton variant="danger" disabled={customerCount > 0}>
        {customerCount > 0 ? t('deleteBlockedByCustomers') : t('delete')}
      </InlineSubmitButton>
      {state?.ok ? <span className="text-xs text-success">{state.message}</span> : null}
    </form>
  );
}
