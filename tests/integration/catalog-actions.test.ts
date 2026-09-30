/**
 * Catalog server actions under a real session (Phase 2).
 *
 * `catalog.test.ts` proves the business rules. This file proves the three things
 * that live between the form and the service, which is where the Phase 1 defect
 * was: the CSRF check, the session check, and the permission check. Each is
 * asserted by calling the action the way Next calls it and then checking that the
 * database did not move.
 *
 * Only the request scope is faked (`cookies()`, `headers()`), the same boundary
 * as `csrf-action.test.ts`.
 */
import { Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieJar = new Map<string, string>();
const headerJar = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
  headers: async () => ({
    get: (name: string) => headerJar.get(name),
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

// Imported after the mocks on purpose: the transforms hoist the mocks above the
// modules under test.
const {
  createCategoryAction,
  createPriceListAction,
  createPriceListItemAction,
  createProductAction,
  createUnitAction,
  deletePriceListItemAction,
  deleteProductAction,
  updateCategoryAction,
  updatePriceListAction,
  updatePriceListItemAction,
  updateUnitAction,
} = await import('@/server/catalog/actions');
const { login } = await import('@/server/auth/service');
const { CSRF_COOKIE, CSRF_FIELD, SESSION_COOKIE } = await import('@/server/auth/session');
const { hashPassword } = await import('@/lib/passwords');
const { prisma } = await import('@/lib/prisma');

const PASSWORD = 'Correct!Horse9';
const ADMIN_PHONE = '+201000000040';
const REP_PHONE = '+201000000041';
const FOREIGN_TOKEN = 'c'.repeat(43);

const CATEGORY = { name: 'مشروبات', nameEn: 'Beverages' };
const UNIT = { name: 'قطعة', nameEn: 'piece' };

async function truncateAll(): Promise<void> {
  // The catalog tables are listed before their dependants so the intent is
  // readable; CASCADE covers the rest.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE price_list_items, price_lists, products, units, product_categories, audit_logs, login_attempts, password_resets, user_sessions, reps, customers, users RESTART IDENTITY CASCADE',
  );
  cookieJar.clear();
  headerJar.clear();
  headerJar.set('user-agent', 'catalog-action-test');
}

async function seedUsers(): Promise<void> {
  await prisma.user.create({
    data: {
      role: Role.ADMIN,
      phone: ADMIN_PHONE,
      username: 'catalogadmin',
      passwordHash: await hashPassword(PASSWORD),
      mustChangePassword: false,
      isActive: true,
    },
  });
  // A rep holds no catalog or pricing permission: the catalog is an office
  // responsibility, and a rep who could edit prices could change what a customer
  // is charged.
  await prisma.user.create({
    data: {
      role: Role.REP,
      phone: REP_PHONE,
      username: 'catalogrep',
      passwordHash: await hashPassword(PASSWORD),
      mustChangePassword: false,
      isActive: true,
    },
  });
}

async function signIn(phone: string): Promise<string> {
  const result = await login({
    identifier: phone,
    password: PASSWORD,
    ip: null,
    userAgent: 'catalog-action-test',
  });
  if (result.status !== 'ok') throw new Error(`could not sign in: ${result.status}`);
  cookieJar.set(SESSION_COOKIE, result.session.id);
  cookieJar.set(CSRF_COOKIE, result.session.csrfToken);
  return result.session.csrfToken;
}

function form(fields: Record<string, string>, token: string | null = null): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  if (token !== null) formData.append(CSRF_FIELD, token);
  return formData;
}

/** A short unique suffix, so one test's rows never collide with another's. */
let sequence = 0;
function unique(): string {
  sequence += 1;
  return String(sequence);
}

async function createCategoryId(token: string): Promise<string> {
  await createCategoryAction(null, form(CATEGORY, token));
  const row = await prisma.productCategory.findFirstOrThrow({ where: { name: CATEGORY.name } });
  return row.id;
}

async function createUnitId(token: string): Promise<string> {
  await createUnitAction(null, form(UNIT, token));
  const row = await prisma.unit.findFirstOrThrow({ where: { name: UNIT.name } });
  return row.id;
}

async function seedProduct(token: string, categoryId?: string, unitId?: string): Promise<string> {
  const category = categoryId ?? (await createCategoryId(token));
  const unit = unitId ?? (await createUnitId(token));
  const code = `BEV-${unique()}`;

  const result = await createProductAction(
    null,
    form(
      {
        code,
        nameAr: 'منتج للاختبار',
        nameEn: '',
        categoryId: category,
        unitId: unit,
        packSize: '',
        vatRate: '14',
        costPrice: '',
        isActive: 'true',
      },
      token,
    ),
  );
  if (!result.ok) throw new Error(`could not create the product: ${result.message}`);

  const row = await prisma.product.findFirstOrThrow({ where: { code } });
  return row.id;
}

async function createPriceListId(token: string): Promise<string> {
  const name = `قائمة ${unique()}`;
  await createPriceListAction(null, form({ name, nameEn: '' }, token));
  const row = await prisma.priceList.findFirstOrThrow({ where: { name } });
  return row.id;
}

beforeEach(async () => {
  await truncateAll();
  await seedUsers();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('a signed in admin', () => {
  it('creates a category through the action, with its audit row', async () => {
    const token = await signIn(ADMIN_PHONE);

    const result = await createCategoryAction(null, form(CATEGORY, token));

    expect(result.ok).toBe(true);
    const row = await prisma.productCategory.findFirstOrThrow();
    expect(row.name).toBe(CATEGORY.name);
    expect(await prisma.auditLog.count({ where: { entityType: 'ProductCategory' } })).toBe(1);
  });

  it('reports a duplicate category as a form error, not a crash', async () => {
    const token = await signIn(ADMIN_PHONE);
    await createCategoryAction(null, form(CATEGORY, token));

    const second = await createCategoryAction(null, form(CATEGORY, token));

    expect(second.ok).toBe(false);
    expect(second.ok === false && second.message).toBe('اسم الفئة مستخدم بالفعل');
    expect(await prisma.productCategory.count()).toBe(1);
  });

  it('returns a field error for empty input instead of writing a blank row', async () => {
    const token = await signIn(ADMIN_PHONE);

    const result = await createCategoryAction(null, form({ name: '', nameEn: '' }, token));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.name).toBe('اسم الفئة مطلوب');
    expect(await prisma.productCategory.count()).toBe(0);
  });

  // `.strict()`: an extra field is a bug in the caller, and ignoring it would
  // hide that bug until a field quietly stopped being stored.
  it('rejects an unknown field rather than ignoring it', async () => {
    const token = await signIn(ADMIN_PHONE);

    const result = await createCategoryAction(null, form({ ...CATEGORY, isAdmin: 'true' }, token));

    expect(result.ok).toBe(false);
    expect(await prisma.productCategory.count()).toBe(0);
  });

  it('rejects a request with no CSRF field and writes nothing', async () => {
    await signIn(ADMIN_PHONE);

    const result = await createCategoryAction(null, form(CATEGORY, null));

    expect(result.ok).toBe(false);
    // The message is for the reader of the form, not a stack trace.
    expect(result.ok === false && result.message).toBe(
      'انتهت صلاحية الجلسة، حدّث الصفحة وحاول مرة أخرى',
    );
    expect(await prisma.productCategory.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityType: 'ProductCategory' } })).toBe(0);
  });

  it('rejects a token that belongs to no session of its own', async () => {
    await signIn(ADMIN_PHONE);

    const result = await createCategoryAction(null, form(CATEGORY, FOREIGN_TOKEN));

    expect(result.ok).toBe(false);
    expect(await prisma.productCategory.count()).toBe(0);
  });

  it('rejects an anonymous request with no session at all', async () => {
    const result = await createCategoryAction(null, form(CATEGORY, FOREIGN_TOKEN));

    expect(result.ok).toBe(false);
    expect(await prisma.productCategory.count()).toBe(0);
  });

  it('deletes a product through the action and keeps the row', async () => {
    const token = await signIn(ADMIN_PHONE);
    const productId = await seedProduct(token);

    const result = await deleteProductAction(null, form({ productId }, token));

    expect(result.ok).toBe(true);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.isActive).toBe(false);
  });

  it('reports a malformed id as a field error', async () => {
    const token = await signIn(ADMIN_PHONE);

    const result = await deleteProductAction(null, form({ productId: 'not-a-uuid' }, token));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.productId).toBe('معرّف غير صالح');
  });
});

describe('a rep', () => {
  it('cannot write the catalog, and nothing is written', async () => {
    const token = await signIn(REP_PHONE);

    const result = await createCategoryAction(null, form(CATEGORY, token));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toBe('ليست لديك صلاحية');
    expect(await prisma.productCategory.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityType: 'ProductCategory' } })).toBe(0);
  });

  it('cannot write pricing either', async () => {
    const token = await signIn(REP_PHONE);

    const result = await createPriceListAction(null, form({ name: 'قائمة', nameEn: '' }, token));

    expect(result.ok).toBe(false);
    expect(await prisma.priceList.count()).toBe(0);
  });
});

describe('product creation through the action', () => {
  it('stores the decimal fields the form sent as strings', async () => {
    const token = await signIn(ADMIN_PHONE);
    const categoryId = await createCategoryId(token);
    const unitId = await createUnitId(token);

    const result = await createProductAction(
      null,
      form(
        {
          code: 'BEV-001',
          nameAr: 'مياه معدنية 600 مل',
          nameEn: 'Mineral water 600ml',
          categoryId,
          unitId,
          packSize: '12',
          vatRate: '14',
          costPrice: '4.50',
          isActive: 'true',
        },
        token,
      ),
    );

    expect(result.ok).toBe(true);
    const row = await prisma.product.findFirstOrThrow();
    expect(row.vatRate.toFixed(2)).toBe('14.00');
    expect(row.costPrice?.toFixed(2)).toBe('4.50');
    expect(row.packSize?.toFixed(3)).toBe('12.000');
    expect(row.isActive).toBe(true);
  });

  it('treats an empty optional field as unset', async () => {
    const token = await signIn(ADMIN_PHONE);
    const categoryId = await createCategoryId(token);
    const unitId = await createUnitId(token);

    const result = await createProductAction(
      null,
      form(
        {
          code: 'BEV-002',
          nameAr: 'عصير برتقال',
          nameEn: '',
          categoryId,
          unitId,
          packSize: '',
          vatRate: '0',
          costPrice: '',
          isActive: 'true',
        },
        token,
      ),
    );

    expect(result.ok).toBe(true);
    const row = await prisma.product.findFirstOrThrow({ where: { code: 'BEV-002' } });
    expect(row.nameEn).toBeNull();
    expect(row.packSize).toBeNull();
    expect(row.costPrice).toBeNull();
    // A zero rate is a real value, not an absent one: goods outside the VAT
    // scope have to be able to say so.
    expect(row.vatRate.toFixed(2)).toBe('0.00');
  });

  it('refuses a non numeric price rather than storing zero', async () => {
    const token = await signIn(ADMIN_PHONE);
    const categoryId = await createCategoryId(token);
    const unitId = await createUnitId(token);
    const productId = await seedProduct(token, categoryId, unitId);
    const listId = await createPriceListId(token);

    const result = await createPriceListItemAction(
      null,
      form(
        {
          priceListId: listId,
          productId,
          price: 'مجانا',
          validFrom: '2026-01-01',
          validTo: '',
        },
        token,
      ),
    );

    expect(result.ok).toBe(false);
    expect(await prisma.priceListItem.count()).toBe(0);
  });

  it('refuses a zero price, because that is not a gift but a mistake', async () => {
    const token = await signIn(ADMIN_PHONE);
    const categoryId = await createCategoryId(token);
    const unitId = await createUnitId(token);
    const productId = await seedProduct(token, categoryId, unitId);
    const listId = await createPriceListId(token);

    const result = await createPriceListItemAction(
      null,
      form(
        { priceListId: listId, productId, price: '0', validFrom: '2026-01-01', validTo: '' },
        token,
      ),
    );

    expect(result.ok).toBe(false);
    expect(await prisma.priceListItem.count()).toBe(0);
  });

  it('refuses an end date before the start date', async () => {
    const token = await signIn(ADMIN_PHONE);
    const categoryId = await createCategoryId(token);
    const unitId = await createUnitId(token);
    const productId = await seedProduct(token, categoryId, unitId);
    const listId = await createPriceListId(token);

    const result = await createPriceListItemAction(
      null,
      form(
        {
          priceListId: listId,
          productId,
          price: '10',
          validFrom: '2026-03-31',
          validTo: '2026-01-01',
        },
        token,
      ),
    );

    expect(result.ok).toBe(false);
    expect(await prisma.priceListItem.count()).toBe(0);
  });

  it('refuses an impossible date instead of shifting the window', async () => {
    const token = await signIn(ADMIN_PHONE);
    const categoryId = await createCategoryId(token);
    const unitId = await createUnitId(token);
    const productId = await seedProduct(token, categoryId, unitId);
    const listId = await createPriceListId(token);

    const result = await createPriceListItemAction(
      null,
      form(
        {
          priceListId: listId,
          productId,
          price: '10',
          validFrom: '2026-02-31',
          validTo: '',
        },
        token,
      ),
    );

    expect(result.ok).toBe(false);
    expect(await prisma.priceListItem.count()).toBe(0);
  });

  it('accepts an open ended window when the end date is left empty', async () => {
    const token = await signIn(ADMIN_PHONE);
    const categoryId = await createCategoryId(token);
    const unitId = await createUnitId(token);
    const productId = await seedProduct(token, categoryId, unitId);
    const listId = await createPriceListId(token);

    const result = await createPriceListItemAction(
      null,
      form(
        { priceListId: listId, productId, price: '10', validFrom: '2026-01-01', validTo: '' },
        token,
      ),
    );

    expect(result.ok).toBe(true);
    const row = await prisma.priceListItem.findFirstOrThrow();
    expect(row.validTo).toBeNull();
  });
});

async function createPriceItemId(token: string): Promise<string> {
  const categoryId = await createCategoryId(token);
  const unitId = await createUnitId(token);
  const productId = await seedProduct(token, categoryId, unitId);
  const listId = await createPriceListId(token);

  const result = await createPriceListItemAction(
    null,
    form(
      { priceListId: listId, productId, price: '10', validFrom: '2026-01-01', validTo: '' },
      token,
    ),
  );
  if (!result.ok) throw new Error(`could not create the price: ${result.message}`);

  return (await prisma.priceListItem.findFirstOrThrow({ where: { priceListId: listId } })).id;
}

describe('editing through the action', () => {
  it('renames a category and audits the name it replaced', async () => {
    const token = await signIn(ADMIN_PHONE);
    const categoryId = await createCategoryId(token);

    const result = await updateCategoryAction(
      null,
      form({ categoryId, name: 'مشروبات غازية', nameEn: 'Soft drinks' }, token),
    );

    expect(result.ok).toBe(true);
    const row = await prisma.productCategory.findUniqueOrThrow({ where: { id: categoryId } });
    expect(row.name).toBe('مشروبات غازية');
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'ProductCategory', action: 'UPDATE' },
    });
    expect(audit.beforeJson).toMatchObject({ name: 'مشروبات' });
  });

  it('renames a unit through the action', async () => {
    const token = await signIn(ADMIN_PHONE);
    const unitId = await createUnitId(token);

    const result = await updateUnitAction(
      null,
      form({ unitId, name: 'علبة', nameEn: 'can' }, token),
    );

    expect(result.ok).toBe(true);
    expect((await prisma.unit.findUniqueOrThrow({ where: { id: unitId } })).name).toBe('علبة');
  });

  it('renames a price list through the action', async () => {
    const token = await signIn(ADMIN_PHONE);
    const priceListId = await createPriceListId(token);

    const result = await updatePriceListAction(
      null,
      form({ priceListId, name: 'سعر البيع', nameEn: '' }, token),
    );

    expect(result.ok).toBe(true);
    expect((await prisma.priceList.findUniqueOrThrow({ where: { id: priceListId } })).name).toBe(
      'سعر البيع',
    );
  });

  it('corrects the price of an existing window without moving its days', async () => {
    const token = await signIn(ADMIN_PHONE);
    const priceItemId = await createPriceItemId(token);

    const result = await updatePriceListItemAction(
      null,
      form({ priceItemId, price: '12.50', validFrom: '2026-01-01', validTo: '' }, token),
    );

    expect(result.ok).toBe(true);
    const row = await prisma.priceListItem.findUniqueOrThrow({ where: { id: priceItemId } });
    expect(row.price.toFixed(2)).toBe('12.50');
    expect(row.validFrom.toISOString()).toBe('2026-01-01T00:00:00.000Z');

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'PriceListItem', action: 'UPDATE' },
    });
    expect(audit.beforeJson).toMatchObject({ price: '10.00' });
    expect(audit.afterJson).toMatchObject({ price: '12.50' });
  });

  it('refuses a price correction that would overlap the next window', async () => {
    const token = await signIn(ADMIN_PHONE);
    const categoryId = await createCategoryId(token);
    const unitId = await createUnitId(token);
    const productId = await seedProduct(token, categoryId, unitId);
    const listId = await createPriceListId(token);

    const first = await createPriceListItemAction(
      null,
      form(
        {
          priceListId: listId,
          productId,
          price: '10',
          validFrom: '2026-01-01',
          validTo: '2026-03-31',
        },
        token,
      ),
    );
    expect(first.ok).toBe(true);
    const second = await createPriceListItemAction(
      null,
      form(
        { priceListId: listId, productId, price: '12', validFrom: '2026-04-01', validTo: '' },
        token,
      ),
    );
    expect(second.ok).toBe(true);

    const secondRow = await prisma.priceListItem.findFirstOrThrow({
      where: { priceListId: listId },
      orderBy: { validFrom: 'desc' },
    });
    const result = await updatePriceListItemAction(
      null,
      form({ priceItemId: secondRow.id, price: '12', validFrom: '2026-03-01', validTo: '' }, token),
    );

    expect(result.ok).toBe(false);
    // The refused edit leaves the row where it was.
    expect(
      (
        await prisma.priceListItem.findUniqueOrThrow({ where: { id: secondRow.id } })
      ).validFrom.toISOString(),
    ).toBe('2026-04-01T00:00:00.000Z');
  });

  it('removes a price item and keeps the value in the audit log', async () => {
    const token = await signIn(ADMIN_PHONE);
    const priceItemId = await createPriceItemId(token);

    const result = await deletePriceListItemAction(null, form({ productId: priceItemId }, token));

    expect(result.ok).toBe(true);
    expect(await prisma.priceListItem.count({ where: { id: priceItemId } })).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'PriceListItem', action: 'DELETE' },
    });
    expect(audit.entityId).toBe(priceItemId);
    expect(audit.beforeJson).toMatchObject({ price: '10.00' });
  });

  it('reports a malformed price item id as a field error', async () => {
    const token = await signIn(ADMIN_PHONE);

    const result = await updatePriceListItemAction(
      null,
      form(
        { priceItemId: 'not-a-uuid', price: '12.50', validFrom: '2026-01-01', validTo: '' },
        token,
      ),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.priceItemId).toBe('معرّف غير صالح');
  });

  it('blocks a rep from editing an existing price, and nothing changes', async () => {
    const adminToken = await signIn(ADMIN_PHONE);
    const priceItemId = await createPriceItemId(adminToken);

    const repToken = await signIn(REP_PHONE);
    const result = await updatePriceListItemAction(
      null,
      form({ priceItemId, price: '99.00', validFrom: '2026-01-01', validTo: '' }, repToken),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toBe('ليست لديك صلاحية');
    expect(
      (await prisma.priceListItem.findUniqueOrThrow({ where: { id: priceItemId } })).price.toFixed(
        2,
      ),
    ).toBe('10.00');
  });
});
