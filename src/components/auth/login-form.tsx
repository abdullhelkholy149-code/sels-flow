'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { CsrfField, Field, FormMessage, SubmitButton } from '@/components/ui/form';
import { loginAction } from '@/server/auth/actions';

/**
 * The login form posts to a server action, so the password never appears in a
 * URL, a query string or a client side router cache entry.
 *
 * Server actions imported into a client component are referenced by reference,
 * not bundled, so importing the action here does not ship the auth service or
 * the database client to the browser.
 */
export function LoginForm({ locale }: { locale: string }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [state, formAction, pending] = useActionState(loginAction, null);

  // The action cannot redirect on success without losing the return path, so
  // the client navigates once the state reports a session.
  useEffect(() => {
    if (state?.ok && !pending) {
      router.replace(`/${locale}/app`);
      router.refresh();
    }
  }, [state, pending, router, locale]);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <CsrfField />
      <Field
        label={t('identifier')}
        name="identifier"
        autoComplete="username"
        placeholder={t('identifierPlaceholder')}
        inputMode="tel"
        dir="ltr"
        error={state && !state.ok ? state.errors.identifier : undefined}
      />
      <Field
        label={t('password')}
        name="password"
        type="password"
        autoComplete="current-password"
        error={state && !state.ok ? state.errors.password : undefined}
      />
      <FormMessage result={state} />
      <SubmitButton pendingLabel={t('signingIn')} className="w-full">
        {t('signIn')}
      </SubmitButton>
    </form>
  );
}
