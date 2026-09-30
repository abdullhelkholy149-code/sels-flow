/**
 * Effective price resolution (Section 5.2).
 *
 * Every function here is pure and takes its inputs, so the rules that decide
 * what a customer pays can be tested without a database, a session or a clock.
 * The database versions live in `queries.ts` and do nothing but fetch rows for
 * these functions to decide.
 *
 * Two rules from the specification drive the shape of this file:
 *  - "The effective price is the item valid on the order date." So resolution is
 *    a function of a *date*, and of nothing else. No "latest row wins" shortcut.
 *  - "A customer has one price list." So an item is always resolved inside one
 *    list, and a product missing from that list has no price at all.
 *
 * A missing price resolves to `null`, never to a fallback. The specification
 * defines no default price, and inventing one would quietly put an amount on an
 * invoice that nobody chose. `null` means "cannot be ordered at this price", and
 * that is a decision for the caller to surface.
 *
 * Date columns are `@db.Date`, which Prisma returns as a `Date` pinned to UTC
 * midnight. Everything is normalised through `toDateOnly` so a timestamp built
 * elsewhere in the day cannot shift a price onto the wrong calendar day.
 */
import { DISPLAY_TIME_ZONE } from '@/lib/constants';
import { Decimal } from '@/lib/format';

/** The part of a price list item that decides whether it applies. */
export interface PriceWindow {
  productId: string;
  price: Decimal.Value;
  validFrom: Date;
  /** `null` means open ended. */
  validTo: Date | null;
}

/** A window that can be inserted, i.e. one that still has an id. */
export interface IdentifiedPriceWindow extends PriceWindow {
  id: string;
}

/**
 * Midnight UTC of the calendar date the given value falls on.
 *
 * Reading the UTC parts is deliberate: the values arrive as UTC midnight already,
 * and `toISOString().slice(0, 10)` would do the same without pulling in the
 * local offset.
 */
export function toDateOnly(value: Date): Date {
  if (Number.isNaN(value.getTime())) {
    throw new TypeError(`Invalid date: ${String(value)}`);
  }
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/** Today in the display time zone, as a date-only value. */
export function todayInCairo(): Date {
  // `en-CA` formats as YYYY-MM-DD, which parses without a timezone involved.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  // The fallback keeps the contract rather than the format: if the formatter ever
  // returned something unparseable, the caller still gets a date and not a
  // timestamp, because a bare `new Date()` would silently shift a price window.
  return parseDateInput(parts) ?? toDateOnly(new Date());
}

/**
 * Parses a `YYYY-MM-DD` string, as submitted by `<input type="date">`, into a
 * date-only value. Returns null for anything else, including impossible dates
 * like `2026-02-31`, so the caller can return a validation error rather than
 * storing a shifted date.
 */
export function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match as unknown as [string, string, string, string];

  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  // Date.UTC rolls over, so 2026-02-31 becomes 2026-03-03. Compare the parts back.
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return date;
}

/**
 * Whether a window covers the given date. Both ends are inclusive: a price that
 * ends on the 30th is still the price on the 30th, and a new price starting on
 * the 31st takes over from then.
 */
export function isValidOn(window: PriceWindow, onDate: Date): boolean {
  const day = toDateOnly(onDate);
  const from = toDateOnly(window.validFrom);
  if (from > day) return false;
  if (window.validTo === null) return true;
  return toDateOnly(window.validTo) >= day;
}

/**
 * The item whose window covers `onDate`, or null.
 *
 * Windows for other products are ignored, so a caller may pass the whole price
 * list. When more than one window could match (which the service prevents, and
 * the unique index makes nearly impossible), the most recent `validFrom` wins:
 * a later price was entered later, and picking it deterministically is better
 * than depending on the row order the database happened to return.
 */
export function resolveEffectivePrice<T extends PriceWindow>(
  windows: readonly T[],
  productId: string,
  onDate: Date,
): T | null {
  let best: T | null = null;
  let bestFrom = 0;

  for (const window of windows) {
    if (window.productId !== productId) continue;
    if (!isValidOn(window, onDate)) continue;

    const from = toDateOnly(window.validFrom).getTime();
    if (best === null || from >= bestFrom) {
      best = window;
      bestFrom = from;
    }
  }

  return best;
}

/** The effective item per product for one date, for a whole price list. */
export function resolveEffectivePrices<T extends PriceWindow>(
  windows: readonly T[],
  onDate: Date,
): ReadonlyMap<string, T> {
  const effective = new Map<string, T>();

  for (const window of windows) {
    if (!isValidOn(window, onDate)) continue;

    const current = effective.get(window.productId);
    if (
      current === undefined ||
      toDateOnly(window.validFrom).getTime() >= toDateOnly(current.validFrom).getTime()
    ) {
      effective.set(window.productId, window);
    }
  }

  return effective;
}

/**
 * Whether two windows for the same product in the same list would both apply on
 * some day. Rejected on insert: "the price valid on that date" stops meaning
 * anything when two of them are valid, and the loser would be decided by chance.
 *
 * Both windows are closed ranges, so they overlap as soon as each one starts no
 * later than the other ends. Windows that only *touch* therefore do overlap: a
 * price ending on the 31st and a price starting on the 31st are both valid on the
 * 31st, which is why a clean handover needs the new window to start on the 1st of
 * the next month.
 */
export function windowsOverlap(
  a: { validFrom: Date; validTo: Date | null },
  b: { validFrom: Date; validTo: Date | null },
): boolean {
  const aFrom = toDateOnly(a.validFrom).getTime();
  const bFrom = toDateOnly(b.validFrom).getTime();
  const aTo = a.validTo === null ? Number.POSITIVE_INFINITY : toDateOnly(a.validTo).getTime();
  const bTo = b.validTo === null ? Number.POSITIVE_INFINITY : toDateOnly(b.validTo).getTime();

  return aFrom <= bTo && bFrom <= aTo;
}
