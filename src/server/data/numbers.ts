/**
 * Gapless business numbers (Section 3 and 6).
 *
 * The counter row is locked with `SELECT ... FOR UPDATE` inside the caller's
 * transaction, so two concurrent requests can never receive the same number.
 * The unique constraint on `(doc_type, year)` is the second line of defence.
 */
import { DocumentType, Prisma } from '@prisma/client';

import type { Tx } from '@/lib/prisma';

const PREFIX: Partial<Record<DocumentType, string>> = {
  ORDER: 'ORD',
  INVOICE: 'INV',
  CREDIT_NOTE: 'CN',
  STOCK_VOUCHER: 'VCH',
  STOCK_COUNT: 'CNT',
  PAYMENT: 'PAY',
  CASH_HANDOVER: 'HND',
  RETURN_REQUEST: 'RET',
  VISIT: 'VIS',
  CUSTOMER_CODE: 'C',
  PRODUCT_CODE: 'P',
  REP_CODE: 'R',
};

export class DuplicateNumberError extends Error {
  constructor(docType: DocumentType) {
    super(`duplicate document number for ${docType}`);
    this.name = 'DuplicateNumberError';
  }
}

/**
 * Returns the next number for the current year, formatted as
 * `<PREFIX><year>-<sequence>` (for example `INV2026-000042`).
 *
 * Must be called inside the same transaction that writes the document, so the
 * number and the row are committed together.
 */
export async function nextDocumentNumber(
  tx: Tx,
  docType: DocumentType,
  year = new Date().getUTCFullYear(),
): Promise<string> {
  const counter = await tx.documentCounter.upsert({
    where: { document_counters_type_year_key: { docType, year } },
    create: { docType, year, lastValue: 0 },
    update: {},
  });

  // Lock the row. `SELECT ... FOR UPDATE` is what makes this safe under
  // concurrency; the upsert above only guarantees the row exists.
  const locked = await tx.$queryRaw<Array<{ last_value: number }>>`
    SELECT last_value FROM document_counters
    WHERE doc_type = ${docType}::"DocumentType" AND year = ${year}
    FOR UPDATE
  `;

  const current = locked[0]?.last_value ?? counter.lastValue;
  const next = current + 1;

  await tx.documentCounter.update({
    where: { id: counter.id },
    data: { lastValue: next },
  });

  const prefix = PREFIX[docType] ?? 'DOC';
  return `${prefix}${year}-${String(next).padStart(6, '0')}`;
}

/** Raised by the caller when the unique constraint catches a rare race. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
