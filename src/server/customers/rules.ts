/**
 * Customer rules that are worth testing without a database.
 *
 * Two of the Section 5.1 rules are decisions rather than plumbing:
 *
 *  - A `CASH` customer pays at delivery (Section 5.4), so a credit limit and a
 *    payment term on such a row are numbers no rule ever reads. Keeping them
 *    would mean two answers to "how much is this customer allowed to owe",
 *    depending on which field a reader happened to look at. They are zeroed
 *    instead, so one row states one thing.
 *  - An opening balance is signed: money the customer already owes is a debit,
 *    and an advance they paid us is a credit. Writing it into the ledger needs
 *    that split decided in one place, because a ledger where both columns can be
 *    non-zero has no defined balance.
 */
import type { PaymentTerms } from '@prisma/client';

import { Decimal } from '@/lib/format';
import { ValidationError } from '@/server/data/access';

export interface CreditTermsInput {
  paymentTerms: PaymentTerms;
  creditLimit: Decimal;
  creditDays: number;
}

export interface CreditTerms {
  paymentTerms: PaymentTerms;
  creditLimit: Decimal;
  creditDays: number;
}

/**
 * Applies the cash/credit rule and rejects the values no rule could act on.
 *
 * The limit is checked *before* the branch on payment terms. Zeroing it for a
 * cash customer is a decision about what the row means; a negative value is
 * nonsense for either kind of customer, and swallowing it here would leave the
 * action's own validation as the only thing standing between a typo and a row
 * whose limit disagrees with every other limit in the book.
 *
 * `CREDIT` with a zero limit is allowed on purpose: it is a real state ("this
 * customer may not buy on credit yet") and it is reached by asking for credit
 * before the office has granted a limit. Refusing it would push operators to
 * leave the terms as `CASH` and set the limit anyway, which is worse.
 */
export function normalizeCreditTerms(input: CreditTermsInput): CreditTerms {
  if (!input.creditLimit.isFinite()) {
    throw new ValidationError('حد الائتمان غير صالح');
  }
  if (input.creditLimit.isNegative()) {
    throw new ValidationError('حد الائتمان لا يمكن أن يكون سالباً');
  }

  if (input.paymentTerms === 'CASH') {
    return { paymentTerms: 'CASH', creditLimit: new Decimal(0), creditDays: 0 };
  }

  if (!Number.isInteger(input.creditDays) || input.creditDays < 0) {
    throw new ValidationError('عدد أيام السداد غير صالح');
  }
  return {
    paymentTerms: 'CREDIT',
    creditLimit: input.creditLimit,
    creditDays: input.creditDays,
  };
}

export interface LedgerSplit {
  debit: Decimal;
  credit: Decimal;
}

/**
 * The debit/credit pair for a signed amount, so exactly one of the two columns
 * carries the value.
 */
export function splitSignedAmount(amount: Decimal): LedgerSplit {
  if (!amount.isFinite()) {
    throw new ValidationError('المبلغ غير صالح');
  }
  return amount.greaterThan(0)
    ? { debit: amount, credit: new Decimal(0) }
    : { debit: new Decimal(0), credit: amount.abs() };
}

/** The balance of a ledger is its debits minus its credits (Section 5.6). */
export function ledgerBalance(entries: readonly { debit: Decimal; credit: Decimal }[]): Decimal {
  return entries.reduce(
    (total, entry) => total.plus(entry.debit).minus(entry.credit),
    new Decimal(0),
  );
}

/**
 * Whether a customer may be ordered from (Section 5.1: a blocked customer cannot
 * place or have an approved order). Phase 5 asks this on approval, so the rule
 * lives where it can be tested once.
 */
export function canReceiveOrders(status: 'ACTIVE' | 'BLOCKED' | 'INACTIVE'): boolean {
  return status === 'ACTIVE';
}
