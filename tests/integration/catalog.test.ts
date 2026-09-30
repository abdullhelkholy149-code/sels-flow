/**
 * Catalog and pricing (Phase 2).
 *
 * The acceptance criterion for this phase is "price resolution by date is
 * tested; admin CRUD works", so these are the two things under test:
 *
 *  1. CRUD against a real PostgreSQL. Soft delete, the refusals when a record is
 *     still referenced, and the audit row that has to land with every write.
 *  2. Resolution by date, through `effectivePriceFor` rather than through the
 *     pure functions `pricing.test.ts` already covers. This is the path the cart
 *     and the invoice will take, and it is the path where a wrong date column
 *     type or a missing `deletedAt` filter would show up.
 */
import { AuditAction, Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { Decimal } from '@/lib/format';
import { hashPassword } from '@/lib/passwords';
import { prisma } from '@/lib/prisma';
import type { Actor } from '@/server/data/access';
import { ValidationError } from '@/server/data/access';
import {
  createPriceList,
  createPriceListItem,
  createProduct,
  createProductCategory,
  createUnit,
  deletePriceList,
  deletePriceListItem,
  deleteProduct,
  deleteProductCategory,
  deleteUnit,
  setProductActive,
  updatePriceList,
  updatePriceListItem,
  updateProduct,
  updateProductCategory,
  updateUnit,
  type ProductInput,
} from '@/server/catalog/service';
import {
  effectivePriceFor,
  effectivePricesFor,
  listPriceListItems,
  listProducts,
  listUnits,
} from '@/server/catalog/queries';

const TRAIL = { ip: '203.0.113.9', userAgent: 'catalog-test' };

/**
 * The actor is a real user row, not a made up id: `audit_logs.actor_user_id` is a
 * foreign key, so an invented id would make every audit write fail.
 */
let ADMIN: Actor;

function actor(id: string, role: Role = Role.ADMIN): Actor {
  return { userId: id, role, repId: null, customerId: null, displayName: 'Catalog Tester' };
}

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

async function resetCatalog(): Promise<void> {
  // Price items cascade from the lists, and products are referenced by category
  // and unit, so truncating the leaf table is not enough.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE price_list_items, price_lists, products, units, product_categories, audit_logs, login_attempts, password_resets, user_sessions, reps, customers, users RESTART IDENTITY CASCADE',
  );
  const user = await prisma.user.create({
    data: {
      role: Role.ADMIN,
      phone: '+201000000050',
      username: 'catalogtester',
      passwordHash: await hashPassword('Correct!Horse9'),
      mustChangePassword: false,
      isActive: true,
    },
  });
  ADMIN = actor(user.id, Role.ADMIN);
}

async function seedCategoryUnit(): Promise<{ categoryId: string; unitId: string }> {
  const category = await createProductCategory(
    ADMIN,
    { name: 'مشروبات', nameEn: 'Beverages' },
    TRAIL,
  );
  const unit = await createUnit(ADMIN, { name: 'قطعة', nameEn: 'piece' }, TRAIL);
  return { categoryId: category.id, unitId: unit.id };
}

function productInput(
  categoryId: string,
  unitId: string,
  overrides: Partial<ProductInput> = {},
): ProductInput {
  return {
    code: 'BEV-001',
    nameAr: 'مياه معدنية 600 مل',
    nameEn: 'Mineral water 600ml',
    categoryId,
    unitId,
    packSize: new Decimal('12'),
    vatRate: new Decimal('14'),
    costPrice: new Decimal('4.50'),
    isActive: true,
    ...overrides,
  };
}

beforeEach(resetCatalog);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('product CRUD', () => {
  it('creates a product and reads it back with its category and unit', async () => {
    const { categoryId, unitId } = await seedCategoryUnit();
    const created = await createProduct(ADMIN, productInput(categoryId, unitId), TRAIL);

    const page = await listProducts({ page: 1 });
    expect(page.total).toBe(1);

    const row = page.rows[0]!;
    expect(row.code).toBe('BEV-001');
    expect(row.categoryName).toBe('مشروبات');
    expect(row.unitName).toBe('قطعة');
    expect(row.vatRate.toFixed(2)).toBe('14.00');
    expect(row.isActive).toBe(true);
    expect(created.id).toBe(row.id);
  });

  it('keeps money exact, with no floating point drift', async () => {
    const { categoryId, unitId } = await seedCategoryUnit();
    // 0.1 + 0.2 in binary floating point is famously 0.30000000000000004.
    await createProduct(
      ADMIN,
      productInput(categoryId, unitId, { costPrice: new Decimal('0.30') }),
      TRAIL,
    );

    const stored = await prisma.product.findFirstOrThrow({ where: { code: 'BEV-001' } });
    expect(stored.costPrice?.toFixed(2)).toBe('0.30');
  });

  it('refuses a duplicate code and writes no second row', async () => {
    const { categoryId, unitId } = await seedCategoryUnit();
    await createProduct(ADMIN, productInput(categoryId, unitId), TRAIL);

    await expect(
      createProduct(ADMIN, productInput(categoryId, unitId, { nameAr: 'نسخة ثانية' }), TRAIL),
    ).rejects.toThrow(ValidationError);

    expect(await prisma.product.count()).toBe(1);
  });

  it('records the change and its audit row', async () => {
    const { categoryId, unitId } = await seedCategoryUnit();
    const created = await createProduct(ADMIN, productInput(categoryId, unitId), TRAIL);

    await updateProduct(
      ADMIN,
      created.id,
      productInput(categoryId, unitId, { nameAr: 'اسم جديد' }),
      TRAIL,
    );

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'Product', action: AuditAction.UPDATE },
    });
    expect(row.entityId).toBe(created.id);
    expect(row.actorRole).toBe(Role.ADMIN);
    expect(row.actorUserId).toBe(ADMIN.userId);
    expect(row.ip).toBe(TRAIL.ip);
    expect(row.beforeJson).toMatchObject({ nameAr: 'مياه معدنية 600 مل' });
    expect(row.afterJson).toMatchObject({ nameAr: 'اسم جديد' });

    const after = await prisma.product.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.nameAr).toBe('اسم جديد');
  });

  it('switches a product off and on without touching the row', async () => {
    const { categoryId, unitId } = await seedCategoryUnit();
    const created = await createProduct(ADMIN, productInput(categoryId, unitId), TRAIL);

    await setProductActive(ADMIN, created.id, false, TRAIL);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: created.id } })).isActive).toBe(
      false,
    );
    expect(await prisma.product.count({ where: { deletedAt: null } })).toBe(1);

    await setProductActive(ADMIN, created.id, true, TRAIL);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: created.id } })).isActive).toBe(
      true,
    );
  });

  // A deleted product has to disappear from the list, but the row has to stay:
  // an invoice from last month still names it.
  it('soft deletes a product: hidden from the catalog, row still present', async () => {
    const { categoryId, unitId } = await seedCategoryUnit();
    const created = await createProduct(ADMIN, productInput(categoryId, unitId), TRAIL);

    await deleteProduct(ADMIN, created.id, TRAIL);

    const page = await listProducts({ page: 1 });
    expect(page.total).toBe(0);
    expect(page.rows).toHaveLength(0);

    const row = await prisma.product.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.isActive).toBe(false);
  });

  it('excludes a deleted product from search and from a category filter', async () => {
    const { categoryId, unitId } = await seedCategoryUnit();
    const created = await createProduct(ADMIN, productInput(categoryId, unitId), TRAIL);
    await deleteProduct(ADMIN, created.id, TRAIL);

    expect((await listProducts({ page: 1, search: 'BEV-001' })).total).toBe(0);
    expect((await listProducts({ page: 1, categoryId })).total).toBe(0);
  });

  it('refuses to delete a product twice', async () => {
    const { categoryId, unitId } = await seedCategoryUnit();
    const created = await createProduct(ADMIN, productInput(categoryId, unitId), TRAIL);
    await deleteProduct(ADMIN, created.id, TRAIL);

    await expect(deleteProduct(ADMIN, created.id, TRAIL)).rejects.toThrow(ValidationError);
  });
});

describe('categories and units', () => {
  it('refuses a duplicate name', async () => {
    await createProductCategory(ADMIN, { name: 'بقالة', nameEn: null }, TRAIL);
    await expect(
      createProductCategory(ADMIN, { name: 'بقالة', nameEn: null }, TRAIL),
    ).rejects.toThrow(ValidationError);
  });

  // The database would allow it (ON DELETE RESTRICT), but the operator needs to
  // know why rather than getting a foreign key error.
  it('refuses to delete a category that still has products', async () => {
    const { categoryId, unitId } = await seedCategoryUnit();
    await createProduct(ADMIN, productInput(categoryId, unitId), TRAIL);

    await expect(deleteProductCategory(ADMIN, categoryId, TRAIL)).rejects.toThrow(/منتجات/);
    expect(
      (await prisma.productCategory.findUniqueOrThrow({ where: { id: categoryId } })).deletedAt,
    ).toBeNull();
  });

  it('refuses to delete a unit that is still used', async () => {
    const { categoryId, unitId } = await seedCategoryUnit();
    await createProduct(ADMIN, productInput(categoryId, unitId), TRAIL);

    await expect(deleteUnit(ADMIN, unitId, TRAIL)).rejects.toThrow(/وحدة/);
  });

  it('deletes an unused category and hides it from the unit and category lists', async () => {
    const category = await createProductCategory(ADMIN, { name: 'معلبات', nameEn: null }, TRAIL);
    await deleteProductCategory(ADMIN, category.id, TRAIL);

    expect(await prisma.productCategory.count({ where: { deletedAt: null } })).toBe(0);
    // The row survives for the audit trail of whatever referenced it.
    expect(await prisma.productCategory.count()).toBe(1);
    expect(await listUnits()).toEqual([]);
  });

  it('counts only live products against a category', async () => {
    const { categoryId, unitId } = await seedCategoryUnit();
    const created = await createProduct(ADMIN, productInput(categoryId, unitId), TRAIL);

    const units = await listUnits();
    expect(units[0]?.productCount).toBe(1);

    await deleteProduct(ADMIN, created.id, TRAIL);
    expect((await listUnits())[0]?.productCount).toBe(0);
  });

  it('renames a category and a unit, recording the change', async () => {
    const { categoryId, unitId } = await seedCategoryUnit();

    await updateProductCategory(
      ADMIN,
      categoryId,
      { name: 'مشروبات غازية', nameEn: 'Soft drinks' },
      TRAIL,
    );
    await updateUnit(ADMIN, unitId, { name: 'علبة', nameEn: 'can' }, TRAIL);

    const category = await prisma.productCategory.findUniqueOrThrow({ where: { id: categoryId } });
    expect(category.name).toBe('مشروبات غازية');
    expect(category.nameEn).toBe('Soft drinks');
    expect((await prisma.unit.findUniqueOrThrow({ where: { id: unitId } })).name).toBe('علبة');

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'ProductCategory', action: AuditAction.UPDATE },
    });
    expect(audit.entityId).toBe(categoryId);
    expect(audit.beforeJson).toMatchObject({ name: 'مشروبات' });
    expect(audit.afterJson).toMatchObject({ name: 'مشروبات غازية' });
  });

  it('refuses to rename a category onto an existing name', async () => {
    const { categoryId } = await seedCategoryUnit();
    await createProductCategory(ADMIN, { name: 'معلبات', nameEn: null }, TRAIL);

    await expect(
      updateProductCategory(ADMIN, categoryId, { name: 'معلبات', nameEn: null }, TRAIL),
    ).rejects.toThrow(ValidationError);

    expect(
      (await prisma.productCategory.findUniqueOrThrow({ where: { id: categoryId } })).name,
    ).toBe('مشروبات');
  });
});

describe('price windows', () => {
  async function seedPricedProduct() {
    const { categoryId, unitId } = await seedCategoryUnit();
    const product = await createProduct(ADMIN, productInput(categoryId, unitId), TRAIL);
    const list = await createPriceList(ADMIN, { name: 'سعر التجزئة', nameEn: 'Retail' }, TRAIL);
    return { productId: product.id, priceListId: list.id };
  }

  it('accepts two windows that do not overlap', async () => {
    const { productId, priceListId } = await seedPricedProduct();

    await createPriceListItem(
      ADMIN,
      {
        priceListId,
        productId,
        price: new Decimal('10.00'),
        validFrom: day('2026-01-01'),
        validTo: day('2026-03-31'),
      },
      TRAIL,
    );
    // The day after the previous window ends is the earliest clean handover.
    await createPriceListItem(
      ADMIN,
      {
        priceListId,
        productId,
        price: new Decimal('12.00'),
        validFrom: day('2026-04-01'),
        validTo: null,
      },
      TRAIL,
    );

    expect(await prisma.priceListItem.count({ where: { priceListId, productId } })).toBe(2);
  });

  it('refuses an overlapping window and stores nothing', async () => {
    const { productId, priceListId } = await seedPricedProduct();
    await createPriceListItem(
      ADMIN,
      {
        priceListId,
        productId,
        price: new Decimal('10.00'),
        validFrom: day('2026-01-01'),
        validTo: day('2026-03-31'),
      },
      TRAIL,
    );

    await expect(
      createPriceListItem(
        ADMIN,
        {
          priceListId,
          productId,
          price: new Decimal('12.00'),
          validFrom: day('2026-03-15'),
          validTo: null,
        },
        TRAIL,
      ),
    ).rejects.toThrow(/سارٍ/);

    expect(await prisma.priceListItem.count({ where: { priceListId, productId } })).toBe(1);
  });

  // Inclusive ends: a window ending on the 31st and one starting on the 31st are
  // both valid on the 31st, so the second one is a clash.
  it('refuses a window that shares its last day with an existing one', async () => {
    const { productId, priceListId } = await seedPricedProduct();
    await createPriceListItem(
      ADMIN,
      {
        priceListId,
        productId,
        price: new Decimal('10.00'),
        validFrom: day('2026-01-01'),
        validTo: day('2026-03-31'),
      },
      TRAIL,
    );

    await expect(
      createPriceListItem(
        ADMIN,
        {
          priceListId,
          productId,
          price: new Decimal('12.00'),
          validFrom: day('2026-03-31'),
          validTo: null,
        },
        TRAIL,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('refuses a window that starts inside an open ended one', async () => {
    const { productId, priceListId } = await seedPricedProduct();
    await createPriceListItem(
      ADMIN,
      {
        priceListId,
        productId,
        price: new Decimal('10.00'),
        validFrom: day('2026-01-01'),
        validTo: null,
      },
      TRAIL,
    );

    await expect(
      createPriceListItem(
        ADMIN,
        {
          priceListId,
          productId,
          price: new Decimal('11.00'),
          validFrom: day('2027-01-01'),
          validTo: day('2027-12-31'),
        },
        TRAIL,
      ),
    ).rejects.toThrow(ValidationError);
  });

  // The overlap check is scoped to one product in one list; the same days in a
  // different list, or for a different product, are two independent prices.
  it('allows the same days in another list and for another product', async () => {
    const { categoryId, unitId } = await seedCategoryUnit();
    const first = await createProduct(ADMIN, productInput(categoryId, unitId), TRAIL);
    const second = await createProduct(
      ADMIN,
      productInput(categoryId, unitId, { code: 'BEV-002', nameAr: 'عصير برتقال' }),
      TRAIL,
    );
    const retail = await createPriceList(ADMIN, { name: 'سعر التجزئة', nameEn: 'Retail' }, TRAIL);
    const wholesale = await createPriceList(
      ADMIN,
      { name: 'سعر الجملة', nameEn: 'Wholesale' },
      TRAIL,
    );

    const window = {
      price: new Decimal('10.00'),
      validFrom: day('2026-01-01'),
      validTo: day('2026-03-31'),
    };

    // Same days, same product, different list.
    await createPriceListItem(
      ADMIN,
      { ...window, priceListId: retail.id, productId: first.id },
      TRAIL,
    );
    await createPriceListItem(
      ADMIN,
      { ...window, priceListId: wholesale.id, productId: first.id },
      TRAIL,
    );
    // Same days, same list, different product.
    await createPriceListItem(
      ADMIN,
      { ...window, priceListId: retail.id, productId: second.id },
      TRAIL,
    );

    expect(await prisma.priceListItem.count()).toBe(3);
    expect((await effectivePriceFor(retail.id, first.id, day('2026-02-01')))?.toFixed(2)).toBe(
      '10.00',
    );
    expect((await effectivePriceFor(retail.id, second.id, day('2026-02-01')))?.toFixed(2)).toBe(
      '10.00',
    );
  });

  it('refuses a duplicate start date for the same product and list', async () => {
    const { productId, priceListId } = await seedPricedProduct();
    const window = {
      priceListId,
      productId,
      price: new Decimal('10.00'),
      validFrom: day('2026-01-01'),
      validTo: day('2026-03-31'),
    };
    await createPriceListItem(ADMIN, window, TRAIL);

    await expect(createPriceListItem(ADMIN, window, TRAIL)).rejects.toThrow(ValidationError);
  });

  it('stores the price exactly and records the window as calendar days', async () => {
    const { productId, priceListId } = await seedPricedProduct();
    await createPriceListItem(
      ADMIN,
      {
        priceListId,
        productId,
        price: new Decimal('1234.56'),
        validFrom: day('2026-02-01'),
        validTo: null,
      },
      TRAIL,
    );

    const row = await prisma.priceListItem.findFirstOrThrow({ where: { priceListId, productId } });
    expect(row.price.toFixed(2)).toBe('1234.56');

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'PriceListItem', action: AuditAction.CREATE },
    });
    expect(audit.afterJson).toMatchObject({
      price: '1234.56',
      validFrom: '2026-02-01',
      validTo: null,
    });
  });

  it('refuses to delete a price list that still holds prices', async () => {
    const { productId, priceListId } = await seedPricedProduct();
    await createPriceListItem(
      ADMIN,
      {
        priceListId,
        productId,
        price: new Decimal('10.00'),
        validFrom: day('2026-01-01'),
        validTo: null,
      },
      TRAIL,
    );

    await expect(deletePriceList(ADMIN, priceListId, TRAIL)).rejects.toThrow(/أسعار/);
    expect(
      (await prisma.priceList.findUniqueOrThrow({ where: { id: priceListId } })).deletedAt,
    ).toBeNull();
  });

  it('deletes an empty price list softly', async () => {
    const list = await createPriceList(ADMIN, { name: 'قائمة فارغة', nameEn: null }, TRAIL);
    await deletePriceList(ADMIN, list.id, TRAIL);

    expect(
      (await prisma.priceList.findUniqueOrThrow({ where: { id: list.id } })).deletedAt,
    ).not.toBeNull();
    expect(await prisma.priceList.findMany({ where: { deletedAt: null } })).toHaveLength(0);
  });

  it('renames a price list and records the old name', async () => {
    const list = await createPriceList(ADMIN, { name: 'سعر التجزئة', nameEn: 'Retail' }, TRAIL);

    await updatePriceList(ADMIN, list.id, { name: 'سعر البيع', nameEn: null }, TRAIL);

    const row = await prisma.priceList.findUniqueOrThrow({ where: { id: list.id } });
    expect(row.name).toBe('سعر البيع');
    expect(row.nameEn).toBeNull();

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'PriceList', action: AuditAction.UPDATE },
    });
    expect(audit.beforeJson).toMatchObject({ name: 'سعر التجزئة' });
    expect(audit.afterJson).toMatchObject({ name: 'سعر البيع' });
  });

  it('edits a price window in place without clashing with itself', async () => {
    const { productId, priceListId } = await seedPricedProduct();
    const created = await createPriceListItem(
      ADMIN,
      {
        priceListId,
        productId,
        price: new Decimal('10.00'),
        validFrom: day('2026-01-01'),
        validTo: day('2026-03-31'),
      },
      TRAIL,
    );

    // A pure price correction on the same days: the row must not see itself as
    // the overlapping window.
    await updatePriceListItem(
      ADMIN,
      created.id,
      { price: new Decimal('10.50'), validFrom: day('2026-01-01'), validTo: day('2026-03-31') },
      TRAIL,
    );

    const row = await prisma.priceListItem.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.price.toFixed(2)).toBe('10.50');
    expect(row.validTo?.toISOString()).toBe('2026-03-31T00:00:00.000Z');

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'PriceListItem', action: AuditAction.UPDATE },
    });
    expect(audit.beforeJson).toMatchObject({ price: '10.00', validTo: '2026-03-31' });
    expect(audit.afterJson).toMatchObject({ price: '10.50', validTo: '2026-03-31' });
  });

  it('refuses to move a window onto a neighbouring one', async () => {
    const { productId, priceListId } = await seedPricedProduct();
    await createPriceListItem(
      ADMIN,
      {
        priceListId,
        productId,
        price: new Decimal('10.00'),
        validFrom: day('2026-01-01'),
        validTo: day('2026-03-31'),
      },
      TRAIL,
    );
    const second = await createPriceListItem(
      ADMIN,
      {
        priceListId,
        productId,
        price: new Decimal('12.00'),
        validFrom: day('2026-04-01'),
        validTo: null,
      },
      TRAIL,
    );

    await expect(
      updatePriceListItem(
        ADMIN,
        second.id,
        { price: new Decimal('12.00'), validFrom: day('2026-03-15'), validTo: null },
        TRAIL,
      ),
    ).rejects.toThrow(/سارٍ/);

    expect(
      (
        await prisma.priceListItem.findUniqueOrThrow({ where: { id: second.id } })
      ).validFrom.toISOString(),
    ).toBe('2026-04-01T00:00:00.000Z');
  });

  it('removes a price row and keeps the value in the audit log', async () => {
    const { productId, priceListId } = await seedPricedProduct();
    const created = await createPriceListItem(
      ADMIN,
      {
        priceListId,
        productId,
        price: new Decimal('9.99'),
        validFrom: day('2026-01-01'),
        validTo: null,
      },
      TRAIL,
    );

    await deletePriceListItem(ADMIN, created.id, TRAIL);

    expect(await prisma.priceListItem.count({ where: { id: created.id } })).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'PriceListItem', action: AuditAction.DELETE },
    });
    expect(audit.entityId).toBe(created.id);
    expect(audit.beforeJson).toMatchObject({ price: '9.99', validTo: null });
  });

  it('frees the days of a deleted window for a new one', async () => {
    const { productId, priceListId } = await seedPricedProduct();
    const created = await createPriceListItem(
      ADMIN,
      {
        priceListId,
        productId,
        price: new Decimal('10.00'),
        validFrom: day('2026-01-01'),
        validTo: day('2026-12-31'),
      },
      TRAIL,
    );
    await deletePriceListItem(ADMIN, created.id, TRAIL);

    await expect(
      createPriceListItem(
        ADMIN,
        {
          priceListId,
          productId,
          price: new Decimal('11.00'),
          validFrom: day('2026-06-01'),
          validTo: null,
        },
        TRAIL,
      ),
    ).resolves.toBeDefined();
  });
});

/**
 * The acceptance criterion: the price one customer pays on one date.
 *
 * Read through `effectivePriceFor`, the function the cart will call, so the query
 * and the date rules are exercised together.
 */
describe('effective price resolution by date', () => {
  async function seedHistory() {
    const { categoryId, unitId } = await seedCategoryUnit();
    const product = await createProduct(ADMIN, productInput(categoryId, unitId), TRAIL);
    const list = await createPriceList(ADMIN, { name: 'سعر التجزئة', nameEn: 'Retail' }, TRAIL);

    await createPriceListItem(
      ADMIN,
      {
        priceListId: list.id,
        productId: product.id,
        price: new Decimal('10.00'),
        validFrom: day('2026-01-01'),
        validTo: day('2026-03-31'),
      },
      TRAIL,
    );
    await createPriceListItem(
      ADMIN,
      {
        priceListId: list.id,
        productId: product.id,
        price: new Decimal('12.50'),
        validFrom: day('2026-04-01'),
        validTo: null,
      },
      TRAIL,
    );

    return { productId: product.id, priceListId: list.id };
  }

  it('returns the old price inside the closed window', async () => {
    const { productId, priceListId } = await seedHistory();
    expect((await effectivePriceFor(priceListId, productId, day('2026-01-01')))?.toFixed(2)).toBe(
      '10.00',
    );
    expect((await effectivePriceFor(priceListId, productId, day('2026-02-15')))?.toFixed(2)).toBe(
      '10.00',
    );
    // The last day is still inside the window: both ends are inclusive.
    expect((await effectivePriceFor(priceListId, productId, day('2026-03-31')))?.toFixed(2)).toBe(
      '10.00',
    );
  });

  it('returns the new price from the day the next window starts', async () => {
    const { productId, priceListId } = await seedHistory();
    expect((await effectivePriceFor(priceListId, productId, day('2026-04-01')))?.toFixed(2)).toBe(
      '12.50',
    );
    expect((await effectivePriceFor(priceListId, productId, day('2026-09-30')))?.toFixed(2)).toBe(
      '12.50',
    );
  });

  it('returns null before the first window rather than a fallback price', async () => {
    const { productId, priceListId } = await seedHistory();
    expect(await effectivePriceFor(priceListId, productId, day('2025-12-31'))).toBeNull();
  });

  it('returns null for a product that is not in the list at all', async () => {
    const { priceListId } = await seedHistory();
    expect(
      await effectivePriceFor(
        priceListId,
        '00000000-0000-4000-8000-000000000000',
        day('2026-05-01'),
      ),
    ).toBeNull();
  });

  it('resolves a whole list on one date', async () => {
    const { priceListId } = await seedHistory();
    const prices = await effectivePricesFor(priceListId, day('2026-02-15'));
    expect(prices.size).toBe(1);
    expect([...prices.values()][0]?.toFixed(2)).toBe('10.00');

    const later = await effectivePricesFor(priceListId, day('2026-06-01'));
    expect([...later.values()][0]?.toFixed(2)).toBe('12.50');
  });

  it('marks the in force window in the list the admin reads', async () => {
    const { priceListId } = await seedHistory();
    const items = await listPriceListItems(priceListId);
    expect(items).toHaveLength(2);

    const current = items.filter((item) => item.isCurrent);
    expect(current).toHaveLength(1);
    // `price` is typed as a Decimal *value* here, so it is wrapped before asking
    // it for a fixed string.
    expect(new Decimal(current[0]!.price).toFixed(2)).toBe('12.50');
    // Newest window first, so the current one leads the table.
    expect(items[0]?.isCurrent).toBe(true);
  });

  // The date column is DATE, not TIMESTAMP. A timezone slip here would price an
  // order one day off, which is invisible until the invoice disagrees with the
  // price the rep was quoted.
  it('stores the window as a calendar day, with no time part', async () => {
    const { priceListId } = await seedHistory();
    const row = await prisma.priceListItem.findFirstOrThrow({
      where: { priceListId },
      orderBy: { validFrom: 'asc' },
    });
    expect(row.validFrom.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(row.validTo?.toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });

  it('resolves today without an explicit date', async () => {
    const { productId, priceListId } = await seedHistory();
    // The open window started in the past, so today falls inside it.
    const today = await effectivePriceFor(priceListId, productId);
    expect(today?.toFixed(2)).toBe('12.50');
  });
});

describe('a refused write', () => {
  // The property that makes the audit trail worth reading: an operation that did
  // not happen must not leave a row saying that it did.
  it('leaves no audit row behind when a price window is refused', async () => {
    const { productId, priceListId } = await seedCategoryUnit().then(
      async ({ categoryId, unitId }) => {
        const product = await createProduct(ADMIN, productInput(categoryId, unitId), TRAIL);
        const list = await createPriceList(ADMIN, { name: 'سعر التجزئة', nameEn: 'Retail' }, TRAIL);
        return { productId: product.id, priceListId: list.id };
      },
    );

    const overlapping = {
      priceListId,
      productId,
      price: new Decimal('10.00'),
      validFrom: day('2026-01-01'),
      validTo: day('2026-06-30'),
    };
    await createPriceListItem(ADMIN, overlapping, TRAIL);
    await expect(createPriceListItem(ADMIN, overlapping, TRAIL)).rejects.toThrow(ValidationError);

    // One CREATE for the product, one for the list, one for the accepted price.
    const rows = await prisma.auditLog.findMany({ where: { entityType: 'PriceListItem' } });
    expect(rows).toHaveLength(1);
  });

  it('leaves no audit row behind when a duplicate product is refused', async () => {
    const { categoryId, unitId } = await seedCategoryUnit();
    await createProduct(ADMIN, productInput(categoryId, unitId), TRAIL);
    await expect(
      createProduct(ADMIN, productInput(categoryId, unitId, { nameAr: 'مكرر' }), TRAIL),
    ).rejects.toThrow(ValidationError);

    const creates = await prisma.auditLog.findMany({
      where: { entityType: 'Product', action: AuditAction.CREATE },
    });
    expect(creates).toHaveLength(1);
    expect(creates[0]?.afterJson).toMatchObject({ code: 'BEV-001', nameAr: 'مياه معدنية 600 مل' });
  });
});
