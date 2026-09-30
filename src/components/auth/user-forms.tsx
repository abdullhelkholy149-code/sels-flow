'use client';

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
import { createUserAction, resetPasswordAction, setUserActiveAction } from '@/server/auth/actions';

const ROLES = ['ADMIN', 'REP', 'CUSTOMER', 'STOREKEEPER', 'ACCOUNTANT'] as const;

export function CreateUserForm() {
  const t = useTranslations('users');
  const tRoles = useTranslations('roles');
  const [state, formAction] = useActionState(createUserAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <CsrfField />
      <FieldErrors errors={state && !state.ok ? state.errors : {}} />

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">{t('role')}</span>
        <select
          name="role"
          defaultValue="REP"
          className="rounded-card border border-surface-border bg-white px-3 py-2.5 text-sm text-ink"
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {tRoles(role)}
            </option>
          ))}
        </select>
      </label>

      <Field
        label={t('name')}
        name="displayName"
        autoComplete="off"
        error={state && !state.ok ? state.errors.displayName : undefined}
      />
      <Field
        label={t('phone')}
        name="phone"
        type="tel"
        inputMode="tel"
        dir="ltr"
        autoComplete="off"
        error={state && !state.ok ? state.errors.phone : undefined}
      />
      <Field
        label={t('username')}
        name="username"
        autoComplete="off"
        required={false}
        error={state && !state.ok ? state.errors.username : undefined}
      />

      <FormMessage result={state} />

      {state?.ok && state.data ? (
        <p className="rounded-card border border-success/30 bg-success-soft p-3 text-sm text-success">
          {t('temporaryPassword')}:{' '}
          <code dir="ltr" className="font-semibold">
            {state.data.temporaryPassword}
          </code>
          <span className="mt-1 block text-xs">{t('temporaryPasswordHint')}</span>
        </p>
      ) : null}

      <SubmitButton>{t('newUser')}</SubmitButton>
    </form>
  );
}

export function ResetPasswordButton({ userId }: { userId: string }) {
  const t = useTranslations('users');
  const [state, formAction] = useActionState(resetPasswordAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <CsrfField />
      <input type="hidden" name="userId" value={userId} />
      <InlineSubmitButton className="px-3 py-1.5 text-xs">{t('resetPassword')}</InlineSubmitButton>
      {state?.ok && state.data ? (
        <code dir="ltr" className="text-xs font-semibold text-success">
          {state.data.temporaryPassword}
        </code>
      ) : null}
    </form>
  );
}

export function ActiveToggleButton({
  userId,
  isActive,
  isSelf,
}: {
  userId: string;
  isActive: boolean;
  isSelf: boolean;
}) {
  const t = useTranslations('users');
  const [state, formAction] = useActionState(setUserActiveAction, null);

  if (isSelf) {
    return <span className="text-xs text-ink-subtle">{t('selfSuspend')}</span>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <CsrfField />
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="isActive" value={isActive ? 'false' : 'true'} />
      <InlineSubmitButton
        variant={isActive ? 'danger' : 'secondary'}
        className="px-3 py-1.5 text-xs"
      >
        {isActive ? t('suspend') : t('reactivate')}
      </InlineSubmitButton>
      {state && !state.ok && state.message ? (
        <span className="text-xs text-danger">{state.message}</span>
      ) : null}
    </form>
  );
}
