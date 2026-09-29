import { defineRouting } from 'next-intl/routing';

/**
 * Arabic is the default locale and drives the RTL layout. English keys are
 * prepared from day one so a second language is configuration, not a refactor.
 */
export const routing = defineRouting({
  locales: ['ar', 'en'],
  defaultLocale: 'ar',
  localePrefix: 'always',
});

export type Locale = (typeof routing.locales)[number];

export const LOCALES = routing.locales;

export const DEFAULT_LOCALE: Locale = routing.defaultLocale;

/**
 * Type guard for a locale string.
 * Local instead of relying on a helper from the i18n library, so the check is
 * explicit and testable.
 */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (routing.locales as readonly string[]).includes(value);
}

export function isRtlLocale(locale: string): boolean {
  return locale === 'ar';
}
