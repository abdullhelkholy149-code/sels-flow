'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition, type ChangeEvent } from 'react';

import { usePathname, useRouter } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';

/** Accessible locale switch. Uses the locale aware router so the path stays. */
export function LocaleSwitcher() {
  const t = useTranslations('nav');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function onChange(event: ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value as Locale;
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <label className="flex items-center gap-2 text-sm text-ink-muted">
      <span className="sr-only sm:not-sr-only">{t('language')}</span>
      <select
        aria-label={t('language')}
        className="rounded-md border border-surface-border bg-white px-2 py-1.5 text-sm text-ink disabled:opacity-60"
        value={locale}
        onChange={onChange}
        disabled={isPending}
      >
        {routing.locales.map((option) => (
          <option key={option} value={option}>
            {option === 'ar' ? 'العربية' : 'English'}
          </option>
        ))}
      </select>
    </label>
  );
}
