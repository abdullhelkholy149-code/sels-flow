import { describe, expect, it } from 'vitest';

import { cn } from '@/lib/cn';
import {
  APP_NAME,
  CURRENCY,
  DISPLAY_TIME_ZONE,
  MONEY_DECIMAL_PLACES,
  QUANTITY_DECIMAL_PLACES,
  STORAGE_TIME_ZONE,
} from '@/lib/constants';

describe('cn', () => {
  it('joins class names and drops falsy values', () => {
    expect(cn('a', false, undefined, 'b', null, 'c')).toBe('a b c');
  });

  it('returns an empty string when nothing is provided', () => {
    expect(cn()).toBe('');
  });
});

describe('global conventions', () => {
  it('stores money with two decimals and quantities with three', () => {
    expect(MONEY_DECIMAL_PLACES).toBe(2);
    expect(QUANTITY_DECIMAL_PLACES).toBe(3);
  });

  it('stores in UTC and displays in Africa/Cairo', () => {
    expect(STORAGE_TIME_ZONE).toBe('UTC');
    expect(DISPLAY_TIME_ZONE).toBe('Africa/Cairo');
  });

  it('trades in Egyptian pounds', () => {
    expect(CURRENCY).toBe('EGP');
  });

  it('exposes a product name', () => {
    expect(APP_NAME.length).toBeGreaterThan(0);
  });
});
