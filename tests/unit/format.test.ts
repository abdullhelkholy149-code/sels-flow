import { describe, expect, it } from 'vitest';

import { DEFAULT_NUMBER_LOCALE } from '@/lib/constants';
import { Decimal, formatDate, formatDateTime, formatMoney, formatNumber, formatPercent, formatQuantity } from '@/lib/format';

/**
 * Formatting rules that are easy to break and expensive to break in an
 * invoice: Western digits, two decimals for money, three for quantity, and
 * half up rounding.
 */
describe('formatMoney', () => {
  it('uses two decimals, grouping and Western digits', () => {
    expect(formatMoney(1250)).toBe('1,250.00 ج.م');
  });

  it('rounds half up at the second decimal', () => {
    expect(formatMoney('1.005')).toBe('1.01 ج.م');
    expect(formatMoney('1.004')).toBe('1.00 ج.م');
    expect(formatMoney('2.675')).toBe('2.68 ج.م');
  });

  it('formats zero and negative amounts', () => {
    expect(formatMoney(0)).toBe('0.00 ج.م');
    expect(formatMoney('-1500.5')).toBe('-1,500.50 ج.م');
  });

  it('uses the label given by the translation file', () => {
    expect(formatMoney(10, { locale: 'en', currencyLabel: 'EGP' })).toBe('10.00 EGP');
  });

  it('accepts big numbers beyond IEEE 754 safe integers', () => {
    const amount = new Decimal('99999999999.99');
    expect(formatMoney(amount)).toBe('99,999,999,999.99 ج.م');
  });
});

describe('formatQuantity', () => {
  it('keeps up to three decimals and trims trailing zeros', () => {
    expect(formatQuantity('2')).toBe('2');
    expect(formatQuantity('2.5')).toBe('2.5');
    expect(formatQuantity('2.5000')).toBe('2.5');
    expect(formatQuantity('2.1234')).toBe('2.123');
    expect(formatQuantity(0)).toBe('0');
  });
});

describe('formatPercent', () => {
  it('formats a percentage without forcing decimals', () => {
    expect(formatPercent('14')).toBe('14%');
    expect(formatPercent('12.5')).toBe('12.5%');
    expect(formatPercent('100')).toBe('100%');
  });
});

describe('formatNumber', () => {
  it('trims zeros and groups thousands', () => {
    expect(formatNumber('1234.5')).toBe('1,234.5');
    expect(formatNumber('1234.567', { maxDecimals: 1 })).toBe('1,234.6');
  });
});

describe('date formatting', () => {
  // 2026-03-01T22:30:00Z is 2026-03-02 00:30 in Africa/Cairo
  const value = '2026-03-01T22:30:00.000Z';
  const arabicIndicDigits = /[\u0660-\u0669\u06f0-\u06f9]/;

  it('shifts the displayed day according to Africa/Cairo', () => {
    expect(formatDate(value)).toContain('2026');
    expect(formatDate(value)).toMatch(/\d{2}\/\d{2}\/2026/);
    expect(formatDate(value)).toContain('02');
  });

  it('never prints Arabic-Indic digits', () => {
    expect(formatDate(value)).not.toMatch(arabicIndicDigits);
    expect(formatDateTime(value)).not.toMatch(arabicIndicDigits);
  });

  it('shows a 24 hour clock in Cairo time', () => {
    expect(formatDateTime(value)).toMatch(/\d{2}:\d{2}/);
    expect(formatDateTime(value)).toContain('00:30');
  });

  it('rejects an invalid date instead of printing "Invalid Date"', () => {
    expect(() => formatDate('not-a-date')).toThrow(TypeError);
  });
});

describe('locale constant', () => {
  it('pins Latin digits regardless of the system locale', () => {
    expect(DEFAULT_NUMBER_LOCALE).toContain('nu-latn');
    expect(DEFAULT_NUMBER_LOCALE).toContain('ca-gregory');
  });
});
