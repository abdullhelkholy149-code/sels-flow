/**
 * Catalog and pricing writes (Phase 2).
 *
 * Every write here:
 *  - takes a transaction client, so the audit row commits with the change or not
 *    at all (`writeAudit` never throws, so a logging failure cannot roll back a
 *    business action either);
 *  - takes the actor, so a future non admin call site cannot quietly write the
 *    whole catalog;
 *  - soft deletes master data instead of removing it, because an order line from
 *    last month still has to be able to name the product it referenced.
 *
 * Money is `Decimal` end to end. A price arrives as a validated decimal, is
 * written to a `NUMERIC(14,2)` column, and is never converted to a JS number on
 * the way in.
 */
import { AuditAction } from '@prisma/client';

import { withTransaction, type Tx } from '@/lib/prisma';
import { writeAudit } from '@/server/audit/service';
import { Decimal } from '@/lib/format';
import { isUniqueViolation } from '@/server/data/numbers';
import { ValidationError, type Actor } from '@/server/data/access';
import { windowsOverlap, type PriceWindow } from '@/server/catalog/pricing';

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

/**
 * Translates a unique violation into a message the form can show. The database
 * stays the authority on uniqueness: a check in JavaScript would be a second
 * rule to keep in step, and it would still be wrong under concurrency.
 */
async function rethrowAsValidation<T>(operation: () => Promise<T>, message: string): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ValidationError(message);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Product categories
// ---------------------------------------------------------------------------

export interface CategoryInput {
  name: string;
  nameEn: string | null;
}

export async function createProductCategory(
  actor: Actor,
  input: CategoryInput,
  trail: AuditTrail,
): Promise<{ id: string }> {
  return withTransaction(async (tx) => {
    const created = await rethrowAsValidation(
      () => tx.productCategory.create({ data: { name: input.name, nameEn: input.nameEn } }),
      'اسم الفئة مستخدم بالفعل',
    );

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.CREATE,
      entityType: 'ProductCategory',
      entityId: created.id,
      after: input,
    });

    return { id: created.id };
  });
}

/**
 * Renames a category. The name is the natural key the seed upserts on, so a
 * clash is reported the same way creation reports it, from the database.
 */
export async function updateProductCategory(
  actor: Actor,
  id: string,
  input: CategoryInput,
  trail: AuditTrail,
): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await tx.productCategory.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new ValidationError('الفئة غير موجودة');

    await rethrowAsValidation(
      () =>
        tx.productCategory.update({
          where: { id },
          data: { name: input.name, nameEn: input.nameEn },
        }),
      'اسم الفئة مستخدم بالفعل',
    );

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.UPDATE,
      entityType: 'ProductCategory',
      entityId: id,
      before: { name: before.name, nameEn: before.nameEn },
      after: input,
    });
  });
}

/**
 * Removes a category from the catalog.
 *
 * Soft delete, never `DELETE FROM`: an order line from last year still names the
 * category it was sold under. A category that still has products is refused
 * rather than silently emptied, because the products would become uncategorised
 * with no way for the operator to see that happened.
 */
export async function deleteProductCategory(
  actor: Actor,
  id: string,
  trail: AuditTrail,
): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await tx.productCategory.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new ValidationError('الفئة غير موجودة');

    const inUse = await tx.product.count({ where: { categoryId: id, deletedAt: null } });
    if (inUse > 0) {
      throw new ValidationError('لا يمكن حذف فئة تحتوي على منتجات، انقل المنتجات أولاً');
    }

    await tx.productCategory.update({ where: { id }, data: { deletedAt: new Date() } });

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.DELETE,
      entityType: 'ProductCategory',
      entityId: id,
      before: { name: before.name },
      after: { deletedAt: new Date().toISOString() },
    });
  });
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export interface UnitInput {
  name: string;
  nameEn: string | null;
}

export async function createUnit(
  actor: Actor,
  input: UnitInput,
  trail: AuditTrail,
): Promise<{ id: string }> {
  return withTransaction(async (tx) => {
    const created = await rethrowAsValidation(
      () => tx.unit.create({ data: { name: input.name, nameEn: input.nameEn } }),
      'اسم الوحدة مستخدم بالفعل',
    );

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.CREATE,
      entityType: 'Unit',
      entityId: created.id,
      after: input,
    });

    return { id: created.id };
  });
}

/** Renames a unit. Same rule as categories: the database decides uniqueness. */
export async function updateUnit(
  actor: Actor,
  id: string,
  input: UnitInput,
  trail: AuditTrail,
): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await tx.unit.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new ValidationError('الوحدة غير موجودة');

    await rethrowAsValidation(
      () => tx.unit.update({ where: { id }, data: { name: input.name, nameEn: input.nameEn } }),
      'اسم الوحدة مستخدم بالفعل',
    );

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.UPDATE,
      entityType: 'Unit',
      entityId: id,
      before: { name: before.name, nameEn: before.nameEn },
      after: input,
    });
  });
}

/** See `deleteProductCategory`: soft delete, and refused while in use. */
export async function deleteUnit(actor: Actor, id: string, trail: AuditTrail): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await tx.unit.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new ValidationError('الوحدة غير موجودة');

    const inUse = await tx.product.count({ where: { unitId: id, deletedAt: null } });
    if (inUse > 0) {
      throw new ValidationError('لا يمكن حذف وحدة مستخدمة في منتجات، غيّر وحدات المنتجات أولاً');
    }

    await tx.unit.update({ where: { id }, data: { deletedAt: new Date() } });

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.DELETE,
      entityType: 'Unit',
      entityId: id,
      before: { name: before.name },
      after: { deletedAt: new Date().toISOString() },
    });
  });
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface ProductInput {
  code: string;
  nameAr: string;
  nameEn: string | null;
  categoryId: string;
  unitId: string;
  packSize: Decimal | null;
  vatRate: Decimal;
  costPrice: Decimal | null;
  isActive: boolean;
}

export async function createProduct(
  actor: Actor,
  input: ProductInput,
  trail: AuditTrail,
): Promise<{ id: string }> {
  return withTransaction(async (tx) => {
    const created = await rethrowAsValidation(
      () => tx.product.create({ data: productData(input) }),
      'كود المنتج مستخدم بالفعل',
    );

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.CREATE,
      entityType: 'Product',
      entityId: created.id,
      after: { ...input, vatRate: input.vatRate.toFixed(2) },
    });

    return { id: created.id };
  });
}

export async function updateProduct(
  actor: Actor,
  id: string,
  input: ProductInput,
  trail: AuditTrail,
): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await tx.product.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new ValidationError('المنتج غير موجود');

    const updated = await rethrowAsValidation(
      () => tx.product.update({ where: { id }, data: productData(input) }),
      'كود المنتج مستخدم بالفعل',
    );

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.UPDATE,
      entityType: 'Product',
      entityId: id,
      before: {
        code: before.code,
        nameAr: before.nameAr,
        vatRate: before.vatRate.toFixed(2),
        isActive: before.isActive,
      },
      after: { ...input, vatRate: input.vatRate.toFixed(2) },
    });

    // `updated` is unused beyond proving the write succeeded; the audit row above
    // is what a reader needs.
    void updated;
  });
}

/**
 * Stops offering a product without deleting it. A product is switched off
 * rather than removed, because past orders, invoices and stock movements refer
 * to it and must keep resolving to a name and a code.
 */
export async function setProductActive(
  actor: Actor,
  id: string,
  isActive: boolean,
  trail: AuditTrail,
): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await tx.product.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new ValidationError('المنتج غير موجود');
    if (before.isActive === isActive) return;

    await tx.product.update({ where: { id }, data: { isActive } });

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.STATUS_CHANGE,
      entityType: 'Product',
      entityId: id,
      before: { isActive: before.isActive },
      after: { isActive },
    });
  });
}

/**
 * Removes a product from the catalog, softly.
 *
 * The row stays, so invoices and stock movements from before the deletion still
 * resolve to a code and a name. Its price windows stay too: they are the history
 * of what the product was sold at, and dropping them would break the audit trail
 * of an old order. What changes is that the product stops being offered.
 */
export async function deleteProduct(actor: Actor, id: string, trail: AuditTrail): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await tx.product.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new ValidationError('المنتج غير موجود');

    await tx.product.update({
      where: { id },
      // Also switched off, so a caller that forgets to filter on `deletedAt`
      // still cannot offer it.
      data: { deletedAt: new Date(), isActive: false },
    });

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.DELETE,
      entityType: 'Product',
      entityId: id,
      before: { code: before.code, nameAr: before.nameAr, isActive: before.isActive },
      after: { deletedAt: new Date().toISOString(), isActive: false },
    });
  });
}

function productData(input: ProductInput) {
  return {
    code: input.code,
    nameAr: input.nameAr,
    nameEn: input.nameEn,
    categoryId: input.categoryId,
    unitId: input.unitId,
    packSize: input.packSize,
    vatRate: input.vatRate,
    costPrice: input.costPrice,
    isActive: input.isActive,
  };
}

// ---------------------------------------------------------------------------
// Price lists
// ---------------------------------------------------------------------------

export interface PriceListInput {
  name: string;
  nameEn: string | null;
}

export async function createPriceList(
  actor: Actor,
  input: PriceListInput,
  trail: AuditTrail,
): Promise<{ id: string }> {
  return withTransaction(async (tx) => {
    const created = await rethrowAsValidation(
      () => tx.priceList.create({ data: { name: input.name, nameEn: input.nameEn } }),
      'اسم قائمة الأسعار مستخدم بالفعل',
    );

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.CREATE,
      entityType: 'PriceList',
      entityId: created.id,
      after: input,
    });

    return { id: created.id };
  });
}

/** Renames a price list. Same rule as categories: the database decides uniqueness. */
export async function updatePriceList(
  actor: Actor,
  id: string,
  input: PriceListInput,
  trail: AuditTrail,
): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await tx.priceList.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new ValidationError('قائمة الأسعار غير موجودة');

    await rethrowAsValidation(
      () =>
        tx.priceList.update({ where: { id }, data: { name: input.name, nameEn: input.nameEn } }),
      'اسم قائمة الأسعار مستخدم بالفعل',
    );

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.UPDATE,
      entityType: 'PriceList',
      entityId: id,
      before: { name: before.name, nameEn: before.nameEn },
      after: input,
    });
  });
}

/**
 * Removes a price list, softly, and only while it is empty.
 *
 * The cascade in the schema would delete its price rows, but a price is evidence
 * of what was charged, so an admin has to clear the list explicitly first. That
 * is also why the list is soft deleted rather than dropped: an order that
 * referenced it still has to find a name.
 */
export async function deletePriceList(actor: Actor, id: string, trail: AuditTrail): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await tx.priceList.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new ValidationError('قائمة الأسعار غير موجودة');

    const items = await tx.priceListItem.count({ where: { priceListId: id } });
    if (items > 0) {
      throw new ValidationError('لا يمكن حذف قائمة أسعار تحتوي على أسعار');
    }

    await tx.priceList.update({ where: { id }, data: { deletedAt: new Date() } });

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.DELETE,
      entityType: 'PriceList',
      entityId: id,
      before: { name: before.name },
      after: { deletedAt: new Date().toISOString() },
    });
  });
}

export interface PriceItemInput {
  priceListId: string;
  productId: string;
  price: Decimal;
  validFrom: Date;
  validTo: Date | null;
}

/**
 * Adds a price window.
 *
 * Overlap is rejected here (decision D-018). A unique index cannot express "no
 * two windows overlap", and the alternative is two valid prices on one day with
 * the loser decided by row order. The check reads the existing windows of the
 * same product in the same list, so it is scoped tightly and hits the composite
 * index.
 */
export async function createPriceListItem(
  actor: Actor,
  input: PriceItemInput,
  trail: AuditTrail,
): Promise<{ id: string }> {
  return withTransaction(async (tx) => {
    const clash = await findOverlappingWindow(tx, input);
    if (clash) {
      throw new ValidationError('يوجد سعر سارٍ لهذا المنتج في نفس الفترة');
    }

    const created = await rethrowAsValidation(
      () =>
        tx.priceListItem.create({
          data: {
            priceListId: input.priceListId,
            productId: input.productId,
            price: input.price,
            validFrom: input.validFrom,
            validTo: input.validTo,
          },
        }),
      'يوجد سعر لنفس المنتج يبدأ في نفس التاريخ',
    );

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.CREATE,
      entityType: 'PriceListItem',
      entityId: created.id,
      after: {
        priceListId: input.priceListId,
        productId: input.productId,
        price: input.price.toFixed(2),
        // Dates as plain days: a timestamp in the audit log would suggest a
        // precision the window does not have.
        validFrom: input.validFrom.toISOString().slice(0, 10),
        validTo: input.validTo ? input.validTo.toISOString().slice(0, 10) : null,
      },
    });

    return { id: created.id };
  });
}

/**
 * The window of an existing price row. The product and the list belong to the
 * row and cannot be moved here: changing which product a price applies to is a
 * new price, not an edit, and would rewrite history under a new product code.
 */
export interface PriceItemWindowInput {
  price: Decimal;
  validFrom: Date;
  validTo: Date | null;
}

/**
 * Corrects the price or the window of an existing row, rejecting an overlap with
 * the rows around it. The row being edited is excluded from the clash check, or
 * it would always clash with itself.
 */
export async function updatePriceListItem(
  actor: Actor,
  id: string,
  input: PriceItemWindowInput,
  trail: AuditTrail,
): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await tx.priceListItem.findFirst({ where: { id } });
    if (!before) throw new ValidationError('السعر غير موجود');

    const clash = await findOverlappingWindow(
      tx,
      {
        priceListId: before.priceListId,
        productId: before.productId,
        validFrom: input.validFrom,
        validTo: input.validTo,
      },
      id,
    );
    if (clash) {
      throw new ValidationError('يوجد سعر سارٍ لهذا المنتج في نفس الفترة');
    }

    await rethrowAsValidation(
      () =>
        tx.priceListItem.update({
          where: { id },
          data: { price: input.price, validFrom: input.validFrom, validTo: input.validTo },
        }),
      'يوجد سعر لنفس المنتج يبدأ في نفس التاريخ',
    );

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.UPDATE,
      entityType: 'PriceListItem',
      entityId: id,
      before: {
        price: before.price.toFixed(2),
        validFrom: before.validFrom.toISOString().slice(0, 10),
        validTo: before.validTo ? before.validTo.toISOString().slice(0, 10) : null,
      },
      after: {
        price: input.price.toFixed(2),
        validFrom: input.validFrom.toISOString().slice(0, 10),
        validTo: input.validTo ? input.validTo.toISOString().slice(0, 10) : null,
      },
    });
  });
}

/**
 * Removes a price row outright.
 *
 * Unlike the master records, a price line has no `deletedAt`, and adding one
 * would change what "the price on a date" means for every reader. A window that
 * was entered by mistake has to be removable, so the row goes and the audit row
 * keeps the value that was there - the evidence lives in `audit_logs`, which is
 * append only.
 */
export async function deletePriceListItem(
  actor: Actor,
  id: string,
  trail: AuditTrail,
): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await tx.priceListItem.findFirst({ where: { id } });
    if (!before) throw new ValidationError('السعر غير موجود');

    await tx.priceListItem.delete({ where: { id } });

    await writeAudit(tx, {
      ...auditContext(actor, trail),
      action: AuditAction.DELETE,
      entityType: 'PriceListItem',
      entityId: id,
      before: {
        priceListId: before.priceListId,
        productId: before.productId,
        price: before.price.toFixed(2),
        validFrom: before.validFrom.toISOString().slice(0, 10),
        validTo: before.validTo ? before.validTo.toISOString().slice(0, 10) : null,
      },
    });
  });
}

/**
 * The first existing window of the same product in the same list that shares at
 * least one day with the candidate.
 *
 * The database filter does the date arithmetic in SQL; the pure `windowsOverlap`
 * then re-checks in JavaScript, so the rule is tested once and used in both
 * places rather than being duplicated as two different SQL predicates.
 */
async function findOverlappingWindow(
  tx: Tx,
  candidate: { priceListId: string; productId: string; validFrom: Date; validTo: Date | null },
  excludeId?: string,
): Promise<PriceWindow | null> {
  const from = candidate.validFrom.toISOString().slice(0, 10);
  const to = (candidate.validTo ?? candidate.validFrom).toISOString().slice(0, 10);

  const existing = await tx.priceListItem.findMany({
    where: {
      priceListId: candidate.priceListId,
      productId: candidate.productId,
      // When editing, the row being changed must not count as its own clash.
      ...(excludeId ? { id: { not: excludeId } } : {}),
      // Keep anything that could touch the candidate: starts before it ends, and
      // has not ended before it starts. An open ended window is +infinity.
      AND: [
        { validFrom: { lte: new Date(`${to}T00:00:00.000Z`) } },
        { OR: [{ validTo: null }, { validTo: { gte: new Date(`${from}T00:00:00.000Z`) } }] },
      ],
    },
  });

  return (
    existing.find((row) =>
      windowsOverlap(
        { validFrom: row.validFrom, validTo: row.validTo },
        { validFrom: candidate.validFrom, validTo: candidate.validTo },
      ),
    ) ?? null
  );
}
