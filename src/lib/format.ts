/**
 * Display formatting helpers.
 *
 * Money and quantities are stored and computed with `decimal.js` only. These
 * helpers exist purely to turn an exact decimal into a human readable string,
 * and they never perform arithmetic.
 */
import Decimal from 'decimal.js';

import {
  DEFAULT_NUMBER_LOCALE,
  DISPLAY_TIME_ZONE,
  MONEY_DECIMAL_PLACES,
  QUANTITY_DECIMAL_PLACES,
} from '@/lib/constants';

/** Half up rounding, as required by Section 3. */
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -21, toExpPos: 21 });

export { Decimal };

export type FormatOptions = {
  locale?: string;
};

function toDecimal(value: Decimal.Value): Decimal {
  return Decimal.isDecimal(value) ? value : new Decimal(value);
}

function numberFormat(locale: string | undefined, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  return new Intl.NumberFormat(locale ?? DEFAULT_NUMBER_LOCALE, options);
}

/** `Intl.NumberFormat.format` accepts a decimal string at runtime. */
type StringCapableFormatter = { format: (value: string) => string };

/**
 * Groups a plain decimal string without ever touching a JS number.
 * `Intl.NumberFormat.format` accepts a string and applies grouping correctly,
 * which keeps the whole formatting path free of floating point.
 */
function groupDecimalString(locale: string | undefined, plain: string, fractionDigits: number): string {
  const formatter = numberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
    useGrouping: true,
  });

  const formatted = (formatter as unknown as StringCapableFormatter).format(plain);

  // Some locales wrap numbers in invisible bidi controls. They break string
  // comparison in tests and copy/paste in Excel, so they are removed here.
  return formatted.replace(/[\u200e\u200f\u061c\u2066-\u2069]/g, '');
}

function trimTrailingZeros(plain: string): string {
  if (!plain.includes('.')) return plain;
  const trimmed = plain.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
}

/**
 * Money: always two decimals, half up, Western digits.
 * The currency label is passed in (or defaulted) so the text comes from i18n
 * and never from a hard coded string inside a component.
 */
export function formatMoney(value: Decimal.Value, options: FormatOptions & { currencyLabel?: string } = {}): string {
  const amount = toDecimal(value).toDecimalPlaces(MONEY_DECIMAL_PLACES, Decimal.ROUND_HALF_UP);
  const formatted = groupDecimalString(options.locale, amount.toFixed(MONEY_DECIMAL_PLACES), MONEY_DECIMAL_PLACES);
  const label = options.currencyLabel ?? defaultCurrencyLabel(options.locale);
  return label ? `${formatted} ${label}` : formatted;
}

/** Quantity: three decimals, trailing zeros trimmed. */
export function formatQuantity(value: Decimal.Value, options: FormatOptions = {}): string {
  const quantity = toDecimal(value).toDecimalPlaces(QUANTITY_DECIMAL_PLACES, Decimal.ROUND_HALF_UP);
  const plain = trimTrailingZeros(quantity.toFixed(QUANTITY_DECIMAL_PLACES));
  return groupDecimalString(options.locale, plain, QUANTITY_DECIMAL_PLACES);
}

/** Percentage: two decimals with a trailing percent sign. */
export function formatPercent(value: Decimal.Value, options: FormatOptions = {}): string {
  const percent = toDecimal(value).toDecimalPlaces(MONEY_DECIMAL_PLACES, Decimal.ROUND_HALF_UP);
  const plain = trimTrailingZeros(percent.toFixed(MONEY_DECIMAL_PLACES));
  return `${groupDecimalString(options.locale, plain, MONEY_DECIMAL_PLACES)}%`;
}

export function formatNumber(value: Decimal.Value, options: FormatOptions & { maxDecimals?: number } = {}): string {
  const maxDecimals = options.maxDecimals ?? MONEY_DECIMAL_PLACES;
  const number = toDecimal(value).toDecimalPlaces(maxDecimals, Decimal.ROUND_HALF_UP);
  const plain = trimTrailingZeros(number.toFixed(maxDecimals));
  return groupDecimalString(options.locale, plain, maxDecimals);
}

/** Date only, Gregorian, rendered in Africa/Cairo. */
export function formatDate(value: Date | string, options: FormatOptions = {}): string {
  return new Intl.DateTimeFormat(options.locale ?? DEFAULT_NUMBER_LOCALE, {
    timeZone: DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(toDate(value));
}

/** Date and time, Gregorian, rendered in Africa/Cairo. */
export function formatDateTime(value: Date | string, options: FormatOptions = {}): string {
  return new Intl.DateTimeFormat(options.locale ?? DEFAULT_NUMBER_LOCALE, {
    timeZone: DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(toDate(value));
}

function toDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid date: ${String(value)}`);
  }
  return date;
}

function defaultCurrencyLabel(locale: string | undefined): string {
  // Falls back to the application default locale (Arabic) when none is given.
  return (locale ?? DEFAULT_NUMBER_LOCALE).startsWith('ar') ? 'ج.م' : 'EGP';
}
