/**
 * Customer and customer category writes (Phase 3).
 *
 * The rules this file enforces:
 *  - The customer's master record, its login account, its first rep assignment
 *    and its opening ledger entry are written in **one** transaction, so
 *    "the customer exists" and "the customer can sign in" are the same statement
 *    (decision D-022).
 *  - Exactly one rep is current. Reassigning closes the open row and opens a new
 *    one in the same transaction, and the history is kept, so a document from
 *    before a reassignment still shows the rep it belonged to (D-021).
 *  - Scope is applied by the *writer*, not only by the screen: a rep calling any
 *    of these with another rep's customer id gets "not found", not a write.
 *  - Money is `Decimal` from the form to the column, never a JS number.
 */
import { AuditAction, CustomerStatus, LedgerEntryType, Role } from '@prisma/client';

import { Decimal } from '@/lib/format';
import { generateTemporaryPassword, hashPassword } from '@/lib/passwords';
import { withTransaction, type Tx } from '@/lib/prisma';
import { writeAudit } from '@/server/audit/service';
import { customerScope, ValidationError, type Actor } from '@/server/data/access';
import { isUniqueViolation, nextDocumentNumber } from '@/server/data/numbers';
import { todayInCairo } from '@/server/catalog/pricing';
import { normalizeCreditTerms, splitSignedAmount, type CreditTermsInput } from './rules';

export interface AuditTrail {
  ip: string | null;
  userAgent: string | null;
}

function auditContext(actor: Actor, trail: AuditTrail) {
  return {
    actorUserId: actor.userId,
    actorRole: actor.role,
    ip: trail.ip,
    userAgent: trail.userAgent,
  };
}

/** A unique violation becomes wording the form can show, not a stack trace. */
async function rethrowAsValidation<T>(operation: () => Promise<T>, message: string): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isUniqueViolation(error)) throw new ValidationError(message);
    throw error;
  }
}

/**
 * The row as the writer is allowed to see it. Out of scope is reported exactly
 * as a missing row, so a guessed id learns nothing (D-011).
 */
async function scopedCustomer(tx: Tx, actor: Actor, id: string) {
  const customer = await tx.customer.findFirst({
    where: { AND: [{ id }, customerScope(actor)] },
    include: { assignments: { where: { toDate: null }, take: 1, select: { repId: true } } },
  });
  if (!customer) throw new ValidationError('العميل غير موجود');
  return customer;
}

// ---------------------------------------------------------------------------
// Customer categories
// ---------------------------------------------------------------------------

export interface CustomerCategoryInput {
  name: string;
  nameEn: string | null;
}

export async function createCustomerCategory(
  actor: Actor,
  input: CustomerCategoryInput,
  trail: AuditTrail,
): Promise<{ id: string }> {
  return withTransaction(async (tx) => {
    const created = await rethrowAsValidation(
      () => tx.customerCategory.create({ data: { name: input.name, nameEn: input.nameEn } }),
      'اسم تصنيف العملاء مستخدم بالفعل',
    );
    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.CREATE,
      entityType: 'CustomerCategory',
      entityId: created.id,
      after: input,
    });
    return { id: created.id };
  });
}

export async function updateCustomerCategory(
  actor: Actor,
  id: string,
  input: CustomerCategoryInput,
  trail: AuditTrail,
): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await tx.customerCategory.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new ValidationError('التصنيف غير موجود');

    await rethrowAsValidation(
      () =>
        tx.customerCategory.update({
          where: { id },
          data: { name: input.name, nameEn: input.nameEn },
        }),
      'اسم تصنيف العملاء مستخدم بالفعل',
    );
    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.UPDATE,
      entityType: 'CustomerCategory',
      entityId: id,
      before: { name: before.name, nameEn: before.nameEn },
      after: input,
    });
  });
}

/**
 * Soft delete, refused while a customer still carries the category. Dropping it
 * would silently uncategorise live customers, and an operator would have no way
 * of seeing that had happened.
 */
export async function deleteCustomerCategory(
  actor: Actor,
  id: string,
  trail: AuditTrail,
): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await tx.customerCategory.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new ValidationError('التصنيف غير موجود');

    const inUse = await tx.customer.count({ where: { categoryId: id, deletedAt: null } });
    if (inUse > 0) {
      throw new ValidationError('لا يمكن حذف تصنيف مستخدم في عملاء، غيّر تصنيف العملاء أولاً');
    }

    await tx.customerCategory.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.DELETE,
      entityType: 'CustomerCategory',
      entityId: id,
      before: { name: before.name },
      after: { deletedAt: new Date().toISOString() },
    });
  });
}

// ---------------------------------------------------------------------------
// Create a customer
// ---------------------------------------------------------------------------

export interface CustomerMasterInput {
  name: string;
  tradeName: string | null;
  contactPerson: string | null;
  phone: string | null;
  address: string | null;
  governorate: string | null;
  city: string | null;
  categoryId: string | null;
  priceListId: string | null;
  receiverType: 'BUSINESS' | 'PERSON' | 'FOREIGN';
  taxRegistrationNumber: string | null;
  nationalId: string | null;
  whatsappOptIn: boolean;
  notes: string | null;
}

export interface CreateCustomerInput extends CustomerMasterInput {
  /** The rep the customer is assigned to. A rep may only name himself. */
  repId: string | null;
  /** Login username, optional; the phone number is always the login id. */
  username: string | null;
  creditTerms: CreditTermsInput;
  /** Signed: positive means the customer already owes this much. */
  openingBalance: Decimal;
}

/**
 * Creates the customer and everything that has to exist with it.
 *
 * `openingBalance` is written to the ledger, not to a balance column, because
 * Section 5.6 derives the balance from the ledger (D-023). A zero opening
 * balance writes no row: an entry that moves nothing is noise, and a customer
 * with no entries has a zero balance by definition.
 */
export async function createCustomer(
  actor: Actor,
  input: CreateCustomerInput,
  trail: AuditTrail,
): Promise<{ id: string; temporaryPassword: string }> {
  const repId = resolveRepId(actor, input.repId);
  const terms = normalizeCreditTerms(input.creditTerms);

  const temporary = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporary);

  return withTransaction(async (tx) => {
    const rep = await tx.rep.findFirst({ where: { id: repId, deletedAt: null } });
    if (!rep) throw new ValidationError('المندوب غير موجود');

    // The customer's phone is also the login identifier, so a customer without
    // one could be created but never signed into. Bound to a local first: a
    // property narrowed by a `throw` is not narrowed inside the closure below.
    const phone = input.phone;
    if (phone === null) {
      throw new ValidationError('رقم الموبايل مطلوب لإنشاء حساب العميل');
    }

    const code = await nextDocumentNumber(tx, 'CUSTOMER_CODE');

    const user = await rethrowAsValidation(
      () =>
        tx.user.create({
          data: {
            role: Role.CUSTOMER,
            phone,
            username: input.username ? input.username.toLowerCase() : null,
            passwordHash,
            // The customer cannot see anything until the password is changed
            // (Section 4, "must change it on first login").
            mustChangePassword: true,
            isActive: true,
          },
          select: { id: true },
        }),
      'رقم الموبايل أو اسم المستخدم مستخدم بالفعل',
    );

    const customer = await tx.customer.create({
      data: {
        userId: user.id,
        code,
        ...masterData(input),
        paymentTerms: terms.paymentTerms,
        creditLimit: terms.creditLimit,
        creditDays: terms.creditDays,
      },
      select: { id: true },
    });

    const today = todayInCairo();
    await tx.customerRepAssignment.create({
      data: {
        customerId: customer.id,
        repId,
        // Set while the row is open, nulled when it closes: the uniqueness
        // guarantee for "one current rep" (D-021).
        openCustomerId: customer.id,
        fromDate: today,
      },
    });

    if (!input.openingBalance.isZero()) {
      const split = splitSignedAmount(input.openingBalance);
      await tx.customerLedgerEntry.create({
        data: {
          customerId: customer.id,
          entryType: LedgerEntryType.OPENING,
          debit: split.debit,
          credit: split.credit,
          balanceAfter: input.openingBalance,
          notes: 'رصيد افتتاحي',
          createdById: actor.userId,
        },
      });
    }

    await tx.passwordReset.create({
      data: {
        userId: user.id,
        issuedById: actor.userId,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.CREATE,
      entityType: 'Customer',
      entityId: customer.id,
      after: {
        code,
        name: input.name,
        repId,
        paymentTerms: terms.paymentTerms,
        creditLimit: terms.creditLimit.toFixed(2),
        creditDays: terms.creditDays,
        openingBalance: input.openingBalance.toFixed(2),
      },
      metadata: { userId: user.id, mustChangePassword: true },
    });

    return { id: customer.id, temporaryPassword: temporary };
  });
}

/**
 * A rep creates customers for himself. Accepting another rep's id would let a rep
 * hand a customer to a colleague and then lose sight of him.
 */
function resolveRepId(actor: Actor, requested: string | null): string {
  if (actor.role === Role.REP) {
    if (requested !== null && requested !== actor.repId) {
      throw new ValidationError('لا يمكنك إنشاء عميل لمندوب آخر');
    }
    if (actor.repId === null) {
      throw new ValidationError('حساب المندوب غير مرتبط بسجل مندوب');
    }
    return actor.repId;
  }
  if (requested === null || requested === '') {
    throw new ValidationError('اختر المندوب المسؤول عن العميل');
  }
  return requested;
}

function masterData(input: CustomerMasterInput) {
  return {
    name: input.name,
    tradeName: input.tradeName,
    contactPerson: input.contactPerson,
    phone: input.phone,
    address: input.address,
    governorate: input.governorate,
    city: input.city,
    categoryId: input.categoryId,
    priceListId: input.priceListId,
    receiverType: input.receiverType,
    taxRegistrationNumber: input.taxRegistrationNumber,
    nationalId: input.nationalId,
    whatsappOptIn: input.whatsappOptIn,
    notes: input.notes,
  };
}

// ---------------------------------------------------------------------------
// Edit a customer
// ---------------------------------------------------------------------------

/**
 * The editable part of the master. Deliberately absent:
 *  - `code`, which is assigned once (D-022 path) and is quoted on documents;
 *  - the opening balance, because the ledger is append only and a later
 *    correction is an ADJUSTMENT row (Phase 6), not an edit of history;
 *  - `lat`/`lng`, which the spec says the rep sets at the first visit (Phase 7).
 */
export async function updateCustomer(
  actor: Actor,
  id: string,
  input: CustomerMasterInput,
  trail: AuditTrail,
): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await scopedCustomer(tx, actor, id);

    await tx.customer.update({ where: { id }, data: masterData(input) });

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.UPDATE,
      entityType: 'Customer',
      entityId: id,
      before: {
        name: before.name,
        tradeName: before.tradeName,
        phone: before.phone,
        city: before.city,
        categoryId: before.categoryId,
        priceListId: before.priceListId,
        whatsappOptIn: before.whatsappOptIn,
      },
      after: masterData(input),
    });
  });
}

/**
 * Credit terms. Separate from the master edit because they move money rules, and
 * a rep may change them on his own customer but not the status or the rep.
 */
export async function updateCreditTerms(
  actor: Actor,
  id: string,
  input: CreditTermsInput,
  trail: AuditTrail,
): Promise<void> {
  const terms = normalizeCreditTerms(input);

  await withTransaction(async (tx) => {
    const before = await scopedCustomer(tx, actor, id);

    await tx.customer.update({
      where: { id },
      data: {
        paymentTerms: terms.paymentTerms,
        creditLimit: terms.creditLimit,
        creditDays: terms.creditDays,
      },
    });

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.UPDATE,
      entityType: 'Customer',
      entityId: id,
      before: {
        paymentTerms: before.paymentTerms,
        creditLimit: before.creditLimit.toFixed(2),
        creditDays: before.creditDays,
      },
      after: {
        paymentTerms: terms.paymentTerms,
        creditLimit: terms.creditLimit.toFixed(2),
        creditDays: terms.creditDays,
      },
    });
  });
}

/**
 * Status change (Section 5.1). A blocked customer is refused by the order rules
 * in Phase 5; blocking here does not suspend the login, because a blocked
 * customer still has a balance to settle and must be able to see it.
 */
export async function setCustomerStatus(
  actor: Actor,
  id: string,
  status: CustomerStatus,
  trail: AuditTrail,
): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await scopedCustomer(tx, actor, id);
    if (before.status === status) return;

    await tx.customer.update({ where: { id }, data: { status } });

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.STATUS_CHANGE,
      entityType: 'Customer',
      entityId: id,
      before: { status: before.status },
      after: { status },
    });
  });
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

/**
 * Moves the customer to another rep, keeping the history.
 *
 * The customer row is locked first so two concurrent reassignments cannot both
 * read the same open row and each leave one behind: the unique `open_customer_id`
 * would reject the second write, but the refusal would read to the operator as a
 * random failure instead of "somebody just reassigned this customer".
 */
export async function reassignCustomer(
  actor: Actor,
  id: string,
  repId: string,
  trail: AuditTrail,
): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM customers WHERE id = ${id}::uuid FOR UPDATE`;

    const customer = await scopedCustomer(tx, actor, id);
    // An inactive rep is still a real record, so refusing him here with a
    // distinct message beats assigning customers to someone who cannot sign in.
    const rep = await tx.rep.findFirst({
      where: { id: repId, deletedAt: null, isActive: true },
    });
    if (!rep) throw new ValidationError('المندوب غير متاح للإسناد');

    const open = await tx.customerRepAssignment.findFirst({
      where: { customerId: id, toDate: null },
    });
    if (open?.repId === repId) {
      throw new ValidationError('العميل مسنَد بالفعل إلى هذا المندوب');
    }

    const today = todayInCairo();

    if (open) {
      // Closed first: the open row's `open_customer_id` must be free before the
      // new row can claim it.
      await tx.customerRepAssignment.update({
        where: { id: open.id },
        data: { toDate: today, openCustomerId: null },
      });
    }

    await tx.customerRepAssignment.create({
      data: { customerId: id, repId, openCustomerId: id, fromDate: today },
    });

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.STATUS_CHANGE,
      entityType: 'Customer',
      entityId: id,
      before: { code: customer.code, repId: open?.repId ?? null },
      after: { repId },
      // The audit trail is what says which rep the customer belonged to at any
      // moment; the assignments table answers "who is he now".
      metadata: { assignmentClosed: open?.id ?? null },
    });
  });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Soft delete, refused while the customer owes money.
 *
 * Deleting a customer with a balance would leave an amount that nobody can
 * collect and no screen can show. The conservative action is to keep the record
 * and let the office settle it first.
 */
export async function deleteCustomer(actor: Actor, id: string, trail: AuditTrail): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await scopedCustomer(tx, actor, id);

    const entries = await tx.customerLedgerEntry.findMany({
      where: { customerId: id },
      select: { debit: true, credit: true },
    });
    const balance = entries.reduce(
      (total, entry) => total.plus(entry.debit).minus(entry.credit),
      new Decimal(0),
    );
    if (!balance.isZero()) {
      throw new ValidationError('لا يمكن حذف عميل عليه رصيد، سوِّ الرصيد أولاً');
    }

    await tx.customer.update({ where: { id }, data: { deletedAt: new Date() } });

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.DELETE,
      entityType: 'Customer',
      entityId: id,
      before: { code: before.code, name: before.name },
      after: { deletedAt: new Date().toISOString() },
    });
  });
}
