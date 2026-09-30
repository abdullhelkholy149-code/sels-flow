import { describe, expect, it } from 'vitest';

import {
  isValidOn,
  parseDateInput,
  resolveEffectivePrice,
  resolveEffectivePrices,
  toDateOnly,
  todayInCairo,
  windowsOverlap,
  type PriceWindow,
} from '@/server/catalog/pricing';

const PRODUCT = 'product-a';
const OTHER = 'product-b';

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function window(overrides: {
  validFrom: string;
  validTo?: string | null;
  price?: PriceWindow['price'];
  productId?: string;
}): PriceWindow {
  return {
    productId: overrides.productId ?? PRODUCT,
    price: overrides.price ?? '100',
    validFrom: day(overrides.validFrom),
    // An absent `validTo` means open ended, which is the common case in tests.
    validTo:
      overrides.validTo === undefined
        ? null
        : overrides.validTo === null
          ? null
          : day(overrides.validTo),
  };
}

describe('parseDateInput', () => {
  it('parses a well formed date as UTC midnight', () => {
    expect(parseDateInput('2026-04-01')?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseDateInput('  2026-04-01 ')).not.toBeNull();
  });

  it.each([
    ['a slash separated date', '2026/04/01'],
    ['a locale format', '01/04/2026'],
    ['a date with a time', '2026-04-01T10:00:00Z'],
    ['a partial date', '2026-04'],
    ['an empty string', ''],
    ['text', 'tomorrow'],
  ])('rejects %s', (_label, value) => {
    expect(parseDateInput(value)).toBeNull();
  });

  // `new Date('2026-02-31')` is a real date in JavaScript, three days later.
  // Accepting it would store a price starting on 3 March under a form that said
  // 31 February.
  it.each([
    ['a day past the end of February', '2026-02-31'],
    ['a day past the end of a 30 day month', '2026-04-31'],
    ['month 13', '2026-13-01'],
    ['day zero', '2026-04-00'],
  ])('rejects %s rather than rolling it over', (_label, value) => {
    expect(parseDateInput(value)).toBeNull();
  });
});

describe('toDateOnly', () => {
  it('keeps the calendar date and drops the time', () => {
    expect(toDateOnly(new Date('2026-04-01T23:59:59.999Z')).toISOString()).toBe(
      '2026-04-01T00:00:00.000Z',
    );
  });

  it('rejects an invalid date instead of returning 1970', () => {
    expect(() => toDateOnly(new Date('not a date'))).toThrow(TypeError);
  });
});

describe('todayInCairo', () => {
  it('returns a date, never a timestamp, so it can be compared to a DATE column', () => {
    const today = todayInCairo();
    expect(today.toISOString().slice(11)).toBe('00:00:00.000Z');
  });

  it('is the Cairo calendar day, which can be a day ahead of UTC', () => {
    const today = todayInCairo().toISOString().slice(0, 10);
    const utc = new Date().toISOString().slice(0, 10);
    // Never more than a day apart, whichever side of midnight Cairo is on.
    const gap = Math.abs(Date.parse(`${today}T00:00:00Z`) - Date.parse(`${utc}T00:00:00Z`));
    expect(gap).toBeLessThanOrEqual(86_400_000);
  });
});

describe('isValidOn', () => {
  const closed = window({ validFrom: '2026-01-01', validTo: '2026-03-31', price: '110' });

  it('is false before the window starts', () => {
    expect(isValidOn(closed, day('2025-12-31'))).toBe(false);
  });

  it('is true on the first day', () => {
    expect(isValidOn(closed, day('2026-01-01'))).toBe(true);
  });

  it('is true in the middle', () => {
    expect(isValidOn(closed, day('2026-02-15'))).toBe(true);
  });

  // Both ends are inclusive, so the last day is still covered.
  it('is true on the last day', () => {
    expect(isValidOn(closed, day('2026-03-31'))).toBe(true);
  });

  it('is false the day after the window ends', () => {
    expect(isValidOn(closed, day('2026-04-01'))).toBe(false);
  });

  it('covers every later day when validTo is null', () => {
    const open = window({ validFrom: '2026-01-01', validTo: null });
    expect(isValidOn(open, day('2026-04-01'))).toBe(true);
    expect(isValidOn(open, day('2099-12-31'))).toBe(true);
  });

  it('ignores the time of day', () => {
    expect(isValidOn(closed, new Date('2026-02-15T23:00:00.000Z'))).toBe(true);
  });
});

describe('resolveEffectivePrice', () => {
  const history = [
    window({ validFrom: '2026-01-01', validTo: '2026-03-31', price: '110' }),
    window({ validFrom: '2026-04-01', validTo: null, price: '120' }),
  ];

  it('returns null when the product has no window at all', () => {
    expect(resolveEffectivePrice(history, 'unknown-product', day('2026-05-01'))).toBeNull();
  });

  it('returns null when every window has expired, rather than a fallback', () => {
    const expired = [window({ validFrom: '2026-01-01', validTo: '2026-03-31' })];
    expect(resolveEffectivePrice(expired, PRODUCT, day('2026-06-01'))).toBeNull();
  });

  it('picks the window covering the date, not the newest row', () => {
    expect(resolveEffectivePrice(history, PRODUCT, day('2026-02-01'))?.price).toBe('110');
    expect(resolveEffectivePrice(history, PRODUCT, day('2026-05-01'))?.price).toBe('120');
  });

  it('ignores windows belonging to another product', () => {
    const mixed = [...history, { ...window({ validFrom: '2026-01-01' }), productId: OTHER }];
    expect(resolveEffectivePrice(mixed, PRODUCT, day('2026-02-01'))?.price).toBe('110');
  });

  it('is deterministic when two windows overlap, taking the later start', () => {
    // The service refuses to create this, but rows can exist from a direct
    // database write, and a price must never depend on row order.
    const overlapping = [
      window({ validFrom: '2026-01-01', validTo: null, price: '100' }),
      window({ validFrom: '2026-03-01', validTo: null, price: '200' }),
    ];
    expect(resolveEffectivePrice(overlapping, PRODUCT, day('2026-03-15'))?.price).toBe('200');
    expect(
      resolveEffectivePrice([...overlapping].reverse(), PRODUCT, day('2026-03-15'))?.price,
    ).toBe('200');
  });
});

describe('resolveEffectivePrices', () => {
  it('resolves every product for one date in a single pass', () => {
    const windows = [
      window({ validFrom: '2026-01-01', validTo: '2026-03-31', price: '110' }),
      window({ validFrom: '2026-04-01', validTo: null, price: '120' }),
      { ...window({ validFrom: '2026-01-01', validTo: null, price: '55' }), productId: OTHER },
    ];

    const current = resolveEffectivePrices(windows, day('2026-02-15'));
    expect(current.get(PRODUCT)?.price).toBe('110');
    expect(current.get(OTHER)?.price).toBe('55');

    const later = resolveEffectivePrices(windows, day('2026-05-01'));
    expect(later.get(PRODUCT)?.price).toBe('120');
    expect(later.get(OTHER)?.price).toBe('55');
  });

  it('omits a product with no valid window instead of inventing a price', () => {
    const windows = [window({ validFrom: '2026-01-01', validTo: '2026-03-31' })];
    expect(resolveEffectivePrices(windows, day('2026-07-01')).has(PRODUCT)).toBe(false);
  });
});

describe('windowsOverlap', () => {
  const base = { validFrom: day('2026-01-01'), validTo: day('2026-03-31') };
  const next = { validFrom: day('2026-04-01'), validTo: day('2026-06-30') };

  it('is false for a clean month to month handover', () => {
    expect(windowsOverlap(base, next)).toBe(false);
    expect(windowsOverlap(next, base)).toBe(false);
  });

  // Inclusive ends mean a shared day is a genuine clash.
  it('is true when one ends on the day the other starts', () => {
    const touching = { validFrom: day('2026-03-31'), validTo: day('2026-05-31') };
    expect(windowsOverlap(base, touching)).toBe(true);
  });

  it('is true when one sits entirely inside the other', () => {
    const inside = { validFrom: day('2026-02-01'), validTo: day('2026-02-28') };
    expect(windowsOverlap(base, inside)).toBe(true);
  });

  it('is true when one contains the other', () => {
    const containing = { validFrom: day('2025-12-01'), validTo: day('2026-07-31') };
    expect(windowsOverlap(base, containing)).toBe(true);
  });

  it('is true when they are identical', () => {
    expect(windowsOverlap(base, { ...base })).toBe(true);
  });

  it('is true when one is open ended and starts before the other ends', () => {
    const open = { validFrom: day('2026-02-01'), validTo: null };
    expect(windowsOverlap(base, open)).toBe(true);
    expect(windowsOverlap(open, base)).toBe(true);
  });

  it('is true when both are open ended', () => {
    const a = { validFrom: day('2026-01-01'), validTo: null };
    const b = { validFrom: day('2030-01-01'), validTo: null };
    expect(windowsOverlap(a, b)).toBe(true);
  });

  it('is false when the open ended one starts after the closed one ends', () => {
    const open = { validFrom: day('2026-04-01'), validTo: null };
    expect(windowsOverlap(base, open)).toBe(false);
  });

  it('is false for windows separated by a single day', () => {
    const after = { validFrom: day('2026-04-02'), validTo: null };
    expect(windowsOverlap(base, after)).toBe(false);
  });
});
