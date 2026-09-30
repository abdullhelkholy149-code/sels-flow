/**
 * Development seed.
 *
 * This is the ONLY file allowed to contain fake data (specification rule 5).
 * Phase 0 seeds the singleton company settings and the first administrator.
 * Phase 1 adds nothing of its own beyond the admin. Phase 2 adds the catalog and
 * the price lists; reps, customers and a month of documents arrive in the phase
 * that introduces them.
 *
 * Every block is idempotent, keyed on the natural unique column rather than on a
 * hard coded id, so running the seed twice changes nothing.
 */
import { Prisma, PrismaClient } from '@prisma/client';

import { getEnv } from '../src/config/env';
import { hashPassword } from '../src/lib/passwords';
import {
  CATEGORIES,
  CURRENT_WINDOW,
  FIRST_WINDOW,
  PRICE_LISTS,
  PRODUCTS,
  UNITS,
} from './seed-data';

const prisma = new PrismaClient();

/** Two hundredths, the precision the price column stores. */
function money(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(2);
}

async function seedCatalog(): Promise<{
  categories: number;
  units: number;
  products: number;
  prices: number;
}> {
  // Units first, then categories: both are referenced by every product row.
  // Every lookup below is checked rather than asserted. A `!` on a Map lookup
  // hands Prisma an undefined id, and the failure then names a uuid instead of
  // the Arabic unit string that actually does not exist.
  const unitIds = new Map<string, string>();
  for (const unit of UNITS) {
    const row = await prisma.unit.upsert({
      where: { name: unit.name },
      create: { name: unit.name, nameEn: unit.nameEn },
      update: {},
    });
    unitIds.set(unit.name, row.id);
  }

  const categoryIds = new Map<string, string>();
  for (const category of CATEGORIES) {
    const row = await prisma.productCategory.upsert({
      where: { name: category.name },
      create: { name: category.name, nameEn: category.nameEn },
      update: {},
    });
    categoryIds.set(category.name, row.id);
  }

  const unitId = (name: string, code: string): string => {
    const id = unitIds.get(name);
    if (id === undefined) throw new Error(`seed product ${code} wants an unknown unit: ${name}`);
    return id;
  };
  const categoryId = (name: string, code: string): string => {
    const id = categoryIds.get(name);
    if (id === undefined)
      throw new Error(`seed product ${code} wants an unknown category: ${name}`);
    return id;
  };

  const productIds = new Map<string, string>();
  for (const product of PRODUCTS) {
    const row = await prisma.product.upsert({
      where: { code: product.code },
      create: {
        code: product.code,
        nameAr: product.nameAr,
        nameEn: product.nameEn,
        categoryId: categoryId(product.category, product.code),
        unitId: unitId(product.unit, product.code),
        packSize: product.packSize,
        costPrice: money(product.cost),
        vatRate: product.vatRate,
        isActive: true,
      },
      update: {},
    });
    productIds.set(product.code, row.id);
  }

  let prices = 0;
  for (const list of PRICE_LISTS) {
    const priceList = await prisma.priceList.upsert({
      where: { name: list.name },
      create: { name: list.name, nameEn: list.nameEn },
      update: {},
    });

    for (const product of PRODUCTS) {
      for (const [index, window] of [FIRST_WINDOW, CURRENT_WINDOW].entries()) {
        // A small rise between the two windows, so a reader can see the history
        // change without editing anything.
        const price = money(product.cost * list.markup * (index === 0 ? 1 : 1.03));
        await prisma.priceListItem.upsert({
          where: {
            // The compound unique selector is derived from the field names. The
            // database index is called price_list_items_unique_start because the
            // schema maps it, and `map` renames only the index in the database.
            priceListId_productId_validFrom: {
              priceListId: priceList.id,
              productId: productIds.get(product.code)!,
              validFrom: window.validFrom,
            },
          },
          create: {
            priceListId: priceList.id,
            productId: productIds.get(product.code)!,
            price,
            validFrom: window.validFrom,
            validTo: window.validTo,
          },
          update: {},
        });
        prices += 1;
      }
    }
  }

  return { categories: CATEGORIES.length, units: unitIds.size, products: productIds.size, prices };
}

async function main(): Promise<void> {
  const env = getEnv();

  await prisma.companySettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      legalName: 'شركة سالز فلو للتوزيع',
      taxRegistrationNumber: null,
      address: 'القاهرة، مصر',
      phone: '+201000000000',
      email: 'info@example.com',
      defaultVatRate: 14,
    },
    update: {},
  });

  const existingAdmin = await prisma.user.findUnique({
    where: { username: env.SEED_ADMIN_USERNAME },
  });

  if (!existingAdmin) {
    const admin = await prisma.user.create({
      data: {
        role: 'ADMIN',
        username: env.SEED_ADMIN_USERNAME,
        phone: env.SEED_ADMIN_PHONE,
        email: null,
        passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
        // Phase 1: the seeded password is temporary, so the first sign-in is
        // forced through the change password screen.
        mustChangePassword: true,
        isActive: true,
      },
    });

    // Record the reset so the issued temporary password is auditable, exactly
    // as an admin initiated reset would be.
    await prisma.passwordReset.create({
      data: {
        userId: admin.id,
        issuedById: null,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });

    process.stdout.write(`admin created (username=${env.SEED_ADMIN_USERNAME})\n`);
  } else {
    process.stdout.write('admin already exists, skipped\n');
  }

  const catalog = await seedCatalog();

  const [users, settings] = await Promise.all([
    prisma.user.count(),
    prisma.companySettings.count(),
  ]);
  process.stdout.write(
    `seed done: users=${users} settings=${settings} categories=${catalog.categories} units=${catalog.units} products=${catalog.products} price_items=${catalog.prices}\n`,
  );
  process.stdout.write(
    `sign in at /ar/login with ${env.SEED_ADMIN_USERNAME} and ${env.SEED_ADMIN_PASSWORD}, then change the password\n`,
  );
}

main()
  .catch((error) => {
    process.stderr.write(`seed failed: ${String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
