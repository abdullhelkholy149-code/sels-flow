import { describe, expect, it } from 'vitest';

import ar from '@/i18n/messages/ar.json';
import en from '@/i18n/messages/en.json';
import { DEFAULT_LOCALE, isRtlLocale, LOCALES } from '@/i18n/routing';

/** Flattens nested translation objects into dot separated key paths. */
function flatten(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') {
    return [prefix];
  }

  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}

const arKeys = flatten(ar);
const enKeys = flatten(en);

describe('i18n message catalogs', () => {
  it('uses Arabic as the default locale and includes the prepared English keys', () => {
    expect(DEFAULT_LOCALE).toBe('ar');
    expect([...LOCALES]).toEqual(['ar', 'en']);
  });

  it('marks Arabic as right-to-left only', () => {
    expect(isRtlLocale('ar')).toBe(true);
    expect(isRtlLocale('en')).toBe(false);
  });

  it('defines exactly the same keys in Arabic and English', () => {
    expect(arKeys).toEqual(enKeys);
  });

  it('contains no empty translation values', () => {
    for (const [locale, catalog] of [
      ['ar', ar],
      ['en', en],
    ] as const) {
      for (const key of flatten(catalog)) {
        const value = key
          .split('.')
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], catalog);
        expect(
          typeof value === 'string' && value.trim().length > 0,
          `${locale}.${key} is empty`,
        ).toBe(true);
      }
    }
  });

  it('keeps Arabic messages free of Latin-only placeholders', () => {
    expect(ar.app.name).not.toBe('SalesFlow');
  });
});
