'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';

import { CsrfField, Field, FormMessage, SubmitButton } from '@/components/ui/form';
import { changePasswordAction } from '@/server/auth/actions';

/**
 * Shown on first sign-in and from the account menu. The server refuses every
 * other page while `must_change_password` is set, so this form is the only
 * reachable screen until the password changes.
 */
export function ChangePasswordForm() {
  const t = useTranslations('auth');
  const [state, formAction] = useActionState(changePasswordAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <CsrfField />
      <Field
        label={t('currentPassword')}
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        error={state && !state.ok ? state.errors.currentPassword : undefined}
      />
      <Field
        label={t('newPassword')}
        name="newPassword"
        type="password"
        autoComplete="new-password"
        error={state && !state.ok ? state.errors.newPassword : undefined}
      />
      <Field
        label={t('confirmPassword')}
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        error={state && !state.ok ? state.errors.confirmPassword : undefined}
      />
      <p className="text-xs text-ink-subtle">{t('passwordHint')}</p>
      <FormMessage result={state} />
      <SubmitButton pendingLabel={t('changing')} className="w-full">
        {t('changePassword')}
      </SubmitButton>
    </form>
  );
}
