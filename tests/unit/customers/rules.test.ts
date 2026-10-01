/**
 * Customer credit and opening-balance rules.
 *
 * The cases here are the ones that turn into money if they are wrong: a cash
 * customer carrying a limit that a later report would read as credit exposure,
 * a negative limit passing as "no limit", an advance booked as a balance the
 * customer owes, and a blocked customer slipping through.
 *
 * Note what is *not* here: parsing "١٠٠٠٫٥٠" out of a form. That belongs to the
 * action's Zod layer, which reports the problem against the field; these
 * functions receive a `Decimal` already and decide policy.
 */
import { describe, expect, it } from 'vitest';

import { Decimal } from '@/lib/format';
import { ValidationError } from '@/server/data/access';
import {
  canReceiveOrders,
  ledgerBalance,
  normalizeCreditTerms,
  splitSignedAmount,
} from '@/server/customers/rules';

function credit(limit: string, days: number) {
  return { paymentTerms: 'CREDIT' as const, creditLimit: new Decimal(limit), creditDays: days };
}

describe('normalizeCreditTerms', () => {
  it('zeroes the limit and the window on a cash customer', () => {
    // Cash pays at delivery, so a limit left on the row would give a report two
    // different answers to "how much may this customer owe", depending on which
    // field the reader happened to look at.
    const result = normalizeCreditTerms({
      paymentTerms: 'CASH',
      creditLimit: new Decimal('5000'),
      creditDays: 30,
    });
    expect(result.creditLimit.toFixed(2)).toBe('0.00');
    expect(result.creditDays).toBe(0);
    expect(result.paymentTerms).toBe('CASH');
  });

  it('refuses a negative cash limit', () => {
    // Cash ignores the limit rather than trusting it, so a bad value must be
    // reported instead of being silently swallowed by the cash branch.
    expect(() =>
      normalizeCreditTerms({
        paymentTerms: 'CASH',
        creditLimit: new Decimal('-1'),
        creditDays: 0,
      }),
    ).toThrow(ValidationError);
  });

  it('accepts a credit customer with a zero limit', () => {
    // Zero is a real state: credit terms, but nothing granted yet. Refusing it
    // would push operators to stay on cash and set a limit anyway.
    const result = normalizeCreditTerms(credit('0', 30));
    expect(result.creditLimit.toFixed(2)).toBe('0.00');
    expect(result.creditDays).toBe(30);
  });

  it('accepts a zero payment window', () => {
    expect(normalizeCreditTerms(credit('1000', 0)).creditDays).toBe(0);
  });

  it('keeps a granted limit and window as they are', () => {
    const result = normalizeCreditTerms(credit('2500.50', 45));
    expect(result.creditLimit.toFixed(2)).toBe('2500.50');
    expect(result.creditDays).toBe(45);
  });

  it.each([
    ['a negative limit', credit('-1', 30)],
    ['a fractional window', credit('1000', 1.5)],
    ['a negative window', credit('1000', -5)],
    [
      'an infinite limit',
      { paymentTerms: 'CREDIT' as const, creditLimit: new Decimal(Infinity), creditDays: 30 },
    ],
  ])('rejects %s', (_label, input) => {
    expect(() => normalizeCreditTerms(input)).toThrow(ValidationError);
  });
});

describe('splitSignedAmount', () => {
  it('books what the customer owes as a debit', () => {
    const result = splitSignedAmount(new Decimal('1000'));
    expect(result.debit.toFixed(2)).toBe('1000.00');
    expect(result.credit.toFixed(2)).toBe('0.00');
  });

  it('books an advance the customer already paid as a credit', () => {
    // The sign is the whole point: a negative opening balance is money in hand,
    // and storing it as a positive one would make the office chase a customer
    // who already paid.
    const result = splitSignedAmount(new Decimal('-250.50'));
    expect(result.credit.toFixed(2)).toBe('250.50');
    expect(result.debit.toFixed(2)).toBe('0.00');
  });

  it('books zero without leaving both columns non-zero', () => {
    const result = splitSignedAmount(new Decimal(0));
    expect(result.debit.toFixed(2)).toBe('0.00');
    expect(result.credit.toFixed(2)).toBe('0.00');
  });

  it('never puts a value in both columns', () => {
    for (const amount of ['0', '1', '-1', '999999.99', '-0.01']) {
      const result = splitSignedAmount(new Decimal(amount));
      const nonZero = [result.debit, result.credit].filter((part) => !part.isZero());
      expect(nonZero).toHaveLength(amount === '0' ? 0 : 1);
    }
  });

  it('refuses an unparseable amount', () => {
    expect(() => splitSignedAmount(new Decimal(NaN))).toThrow(ValidationError);
    expect(() => splitSignedAmount(new Decimal(Infinity))).toThrow(ValidationError);
  });
});

describe('ledgerBalance', () => {
  it('is debits minus credits', () => {
    const balance = ledgerBalance([
      { debit: new Decimal('1000.00'), credit: new Decimal(0) },
      { debit: new Decimal(0), credit: new Decimal('250.50') },
      { debit: new Decimal('100.25'), credit: new Decimal(0) },
    ]);
    expect(balance.toFixed(2)).toBe('849.75');
  });

  it('is zero with no entries', () => {
    expect(ledgerBalance([]).toFixed(2)).toBe('0.00');
  });

  it('is negative when the customer is in credit', () => {
    expect(ledgerBalance([{ debit: new Decimal(0), credit: new Decimal('300') }]).toFixed(2)).toBe(
      '-300.00',
    );
  });

  it('does not accumulate in floating point', () => {
    // 0.1 + 0.2 is not 0.3 in binary floating point. Ten cents added ten times
    // is exactly one unit of money, so this has to stay decimal arithmetic.
    const entries = Array.from({ length: 10 }, () => ({
      debit: new Decimal('0.10'),
      credit: new Decimal(0),
    }));
    expect(ledgerBalance(entries).toFixed(2)).toBe('1.00');
  });
});

describe('canReceiveOrders', () => {
  it('allows an active customer', () => {
    expect(canReceiveOrders('ACTIVE')).toBe(true);
  });

  it.each(['BLOCKED', 'INACTIVE'] as const)('refuses a %s customer', (status) => {
    expect(canReceiveOrders(status)).toBe(false);
  });

  it('does not ask about the credit limit', () => {
    // Over-limit is a *warning* before the order and a hard stop only with the
    // credit approval permission (Section 5.4). Folding that into this predicate
    // would block an order the specification says may still be taken.
    expect(canReceiveOrders('ACTIVE')).toBe(true);
  });
});
