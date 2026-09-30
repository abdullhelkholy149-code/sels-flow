import { describe, expect, it } from 'vitest';

import {
  CATEGORIES,
  CURRENT_WINDOW,
  FIRST_WINDOW,
  PRICE_LISTS,
  PRODUCTS,
  UNITS,
} from '../../../prisma/seed-data';

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

describe('seed catalog data', () => {
  it('names the same unit and category on both sides of every reference', () => {
    const unitNames = new Set(UNITS.map((unit) => unit.name));
    const categoryNames = new Set(CATEGORIES.map((category) => category.name));

    const unknownUnits = PRODUCTS.filter((product) => !unitNames.has(product.unit)).map(
      (product) => `${product.code} -> ${product.unit}`,
    );
    const unknownCategories = PRODUCTS.filter(
      (product) => !categoryNames.has(product.category),
    ).map((product) => `${product.code} -> ${product.category}`);

    expect(unknownUnits).toEqual([]);
    expect(unknownCategories).toEqual([]);
  });

  it('keeps the natural keys unique, because the seed upserts on them', () => {
    expect(duplicates(PRODUCTS.map((product) => product.code))).toEqual([]);
    expect(duplicates(UNITS.map((unit) => unit.name))).toEqual([]);
    expect(duplicates(CATEGORIES.map((category) => category.name))).toEqual([]);
    expect(duplicates(PRICE_LISTS.map((list) => list.name))).toEqual([]);
  });

  it('leaves no product without a positive cost and a vat rate inside 0..100', () => {
    for (const product of PRODUCTS) {
      expect(product.cost, `${product.code} cost`).toBeGreaterThan(0);
      expect(product.vatRate, `${product.code} vatRate`).toBeGreaterThanOrEqual(0);
      expect(product.vatRate, `${product.code} vatRate`).toBeLessThanOrEqual(100);
      if (product.packSize !== null) {
        expect(product.packSize, `${product.code} packSize`).toBeGreaterThan(1);
      }
    }
  });

  it('prices every product above its cost, so no window resolves to zero', () => {
    for (const list of PRICE_LISTS) {
      expect(list.markup, `${list.name} markup`).toBeGreaterThan(1);
    }
  });

  it('touches the two windows without overlapping them, per D-018', () => {
    expect(FIRST_WINDOW.validTo).not.toBeNull();
    expect(FIRST_WINDOW.validTo!.getTime()).toBeLessThan(CURRENT_WINDOW.validFrom.getTime());
    expect(CURRENT_WINDOW.validTo).toBeNull();
  });
});
