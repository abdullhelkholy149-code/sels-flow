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

function numberFormat(
  locale: string | undefined,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  return new Intl.NumberFormat(locale ?? DEFAULT_NUMBER_LOCALE, options);
}

/** `Intl.NumberFormat.format` accepts a decimal string at runtime. */
type StringCapableFormatter = { format: (value: string) => string };

/**
 * Invisible bidirectional controls. Intl injects them in Arabic locales
 * (for example between the date and the time). They are invisible but they
 * break string comparison, copy/paste into Excel, and PDF text extraction, so
 * every formatted value goes through this cleanup.
 */
const BIDI_CONTROLS = /[\u200e\u200f\u061c\u2066-\u2069]/g;

function stripBidi(value: string): string {
  return value.replace(BIDI_CONTROLS, '');
}

/**
 * Groups a plain decimal string without ever touching a JS number.
 * `Intl.NumberFormat.format` accepts a string and applies grouping correctly,
 * which keeps the whole formatting path free of floating point.
 */
function groupDecimalString(
  locale: string | undefined,
  plain: string,
  minFractionDigits: number,
  maxFractionDigits: number,
): string {
  const formatter = numberFormat(locale, {
    minimumFractionDigits: minFractionDigits,
    maximumFractionDigits: maxFractionDigits,
    useGrouping: true,
  });

  return stripBidi((formatter as unknown as StringCapableFormatter).format(plain));
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
export function formatMoney(
  value: Decimal.Value,
  options: FormatOptions & { currencyLabel?: string } = {},
): string {
  const amount = toDecimal(value).toDecimalPlaces(MONEY_DECIMAL_PLACES, Decimal.ROUND_HALF_UP);
  const formatted = groupDecimalString(
    options.locale,
    amount.toFixed(MONEY_DECIMAL_PLACES),
    MONEY_DECIMAL_PLACES,
    MONEY_DECIMAL_PLACES,
  );
  const label = options.currencyLabel ?? defaultCurrencyLabel(options.locale);
  return label ? `${formatted} ${label}` : formatted;
}

/** Quantity: three decimals, trailing zeros trimmed. */
export function formatQuantity(value: Decimal.Value, options: FormatOptions = {}): string {
  const quantity = toDecimal(value).toDecimalPlaces(QUANTITY_DECIMAL_PLACES, Decimal.ROUND_HALF_UP);
  const plain = trimTrailingZeros(quantity.toFixed(QUANTITY_DECIMAL_PLACES));
  return groupDecimalString(options.locale, plain, 0, QUANTITY_DECIMAL_PLACES);
}

/** Percentage: two decimals with a trailing percent sign. */
export function formatPercent(value: Decimal.Value, options: FormatOptions = {}): string {
  const percent = toDecimal(value).toDecimalPlaces(MONEY_DECIMAL_PLACES, Decimal.ROUND_HALF_UP);
  const plain = trimTrailingZeros(percent.toFixed(MONEY_DECIMAL_PLACES));
  return `${groupDecimalString(options.locale, plain, 0, MONEY_DECIMAL_PLACES)}%`;
}

export function formatNumber(
  value: Decimal.Value,
  options: FormatOptions & { maxDecimals?: number } = {},
): string {
  const maxDecimals = options.maxDecimals ?? MONEY_DECIMAL_PLACES;
  const number = toDecimal(value).toDecimalPlaces(maxDecimals, Decimal.ROUND_HALF_UP);
  const plain = trimTrailingZeros(number.toFixed(maxDecimals));
  return groupDecimalString(options.locale, plain, 0, maxDecimals);
}

/** Date only, Gregorian, rendered in Africa/Cairo. */
export function formatDate(value: Date | string, options: FormatOptions = {}): string {
  return stripBidi(
    new Intl.DateTimeFormat(options.locale ?? DEFAULT_NUMBER_LOCALE, {
      timeZone: DISPLAY_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(toDate(value)),
  );
}

/** Date and time, Gregorian, 24 hour clock, rendered in Africa/Cairo. */
export function formatDateTime(value: Date | string, options: FormatOptions = {}): string {
  return stripBidi(
    new Intl.DateTimeFormat(options.locale ?? DEFAULT_NUMBER_LOCALE, {
      timeZone: DISPLAY_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      // Arabic locales default to a 12 hour clock with ص/م. Invoices and
      // statements use a 24 hour clock to stay unambiguous.
      hourCycle: 'h23',
    }).format(toDate(value)),
  );
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
