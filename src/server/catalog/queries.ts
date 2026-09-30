/**
 * Catalog and price list reads (Section 7: Products/categories/units, Price lists).
 *
 * Reads only. Every write goes through `service.ts` inside a transaction with its
 * audit row, and every decision about *which price applies* belongs to
 * `pricing.ts`, which is pure and holds no database code.
 *
 * Soft deletes are filtered in the `where` rather than in JavaScript, so a
 * deleted master record cannot appear in a count, a search or a price lookup.
 */
import type { Prisma } from '@prisma/client';

import { Decimal } from '@/lib/format';
import { prisma } from '@/lib/prisma';
import { paginate, safeOrderBy, type ListQuery, type Page } from '@/server/data/access';
import {
  resolveEffectivePrice,
  resolveEffectivePrices,
  todayInCairo,
  type PriceWindow,
} from '@/server/catalog/pricing';

/** Only real columns are listed, so a sort link cannot fail the query. */
const PRODUCT_SORTABLE = ['code', 'nameAr', 'vatRate', 'isActive', 'createdAt'] as const;
type ProductSortable = (typeof PRODUCT_SORTABLE)[number];

export interface ProductRow {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  categoryId: string;
  categoryName: string;
  unitId: string;
  unitName: string;
  packSize: Decimal | null;
  vatRate: Decimal;
  costPrice: Decimal | null;
  isActive: boolean;
}

export async function listProducts(
  query: ListQuery & { search?: string; categoryId?: string },
): Promise<Page<ProductRow>> {
  const search = query.search?.trim();
  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search } },
            { nameAr: { contains: search } },
            { nameEn: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  return paginate<ProductRow>(
    query,
    () => prisma.product.count({ where }),
    async ({ skip, take }) => {
      const products = await prisma.product.findMany({
        where,
        orderBy: safeOrderBy<ProductSortable>(PRODUCT_SORTABLE, query.sort, query.direction, {
          code: 'asc',
        }),
        skip,
        take,
        include: { category: true, unit: true },
      });

      return products.map((product) => ({
        id: product.id,
        code: product.code,
        nameAr: product.nameAr,
        nameEn: product.nameEn,
        categoryId: product.categoryId,
        categoryName: product.category.name,
        unitId: product.unitId,
        unitName: product.unit.name,
        packSize: product.packSize,
        vatRate: product.vatRate,
        costPrice: product.costPrice,
        // A soft deleted product is not offered, whatever the flag says.
        isActive: product.isActive && product.deletedAt === null,
      }));
    },
  );
}

export interface CategoryRow {
  id: string;
  name: string;
  nameEn: string | null;
  productCount: number;
}

export async function listProductCategories(): Promise<CategoryRow[]> {
  return prisma.productCategory
    .findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: { where: { deletedAt: null } } } } },
    })
    .then((rows) =>
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        nameEn: row.nameEn,
        productCount: row._count.products,
      })),
    );
}

export interface UnitRow {
  id: string;
  name: string;
  nameEn: string | null;
  productCount: number;
}

export async function listUnits(): Promise<UnitRow[]> {
  return prisma.unit
    .findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: { where: { deletedAt: null } } } } },
    })
    .then((rows) =>
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        nameEn: row.nameEn,
        productCount: row._count.products,
      })),
    );
}

export interface PriceListRow {
  id: string;
  name: string;
  nameEn: string | null;
  itemCount: number;
  createdAt: Date;
}

export async function listPriceLists(): Promise<PriceListRow[]> {
  const rows = await prisma.priceList.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
    include: { _count: { select: { items: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    nameEn: row.nameEn,
    itemCount: row._count.items,
    createdAt: row.createdAt,
  }));
}

export interface PriceListItemRow extends IdentifiedWindow {
  productCode: string;
  productNameAr: string;
  unitName: string;
  vatRate: Decimal;
  /** The item currently in force, so the screen can show it next to the history. */
  isCurrent: boolean;
}

/** A price list item as stored, plus the row identity the screen needs. */
interface IdentifiedWindow extends PriceWindow {
  id: string;
}

export async function getPriceList(id: string): Promise<{
  id: string;
  name: string;
  nameEn: string | null;
} | null> {
  return prisma.priceList.findFirst({ where: { id, deletedAt: null } });
}

/** Every window in a list, newest window first. */
export async function listPriceListItems(priceListId: string): Promise<PriceListItemRow[]> {
  const today = todayInCairo();
  const items = await prisma.priceListItem.findMany({
    where: { priceListId },
    orderBy: [{ product: { code: 'asc' } }, { validFrom: 'desc' }],
    include: { product: { include: { unit: true } } },
  });

  const effective = resolveEffectivePrices(items, today);

  return items.map((item) => ({
    id: item.id,
    productId: item.productId,
    price: item.price,
    validFrom: item.validFrom,
    validTo: item.validTo,
    productCode: item.product.code,
    productNameAr: item.product.nameAr,
    unitName: item.product.unit.name,
    vatRate: item.product.vatRate,
    isCurrent: effective.get(item.productId)?.id === item.id,
  }));
}

/**
 * The price one customer pays for one product on one date, or null when the
 * product has no window covering that date.
 *
 * This is the function the cart and the invoice will call. It is kept here,
 * next to the query, so a caller cannot reach a price without going through the
 * date rules in `pricing.ts`.
 */
export async function effectivePriceFor(
  priceListId: string,
  productId: string,
  onDate: Date = todayInCairo(),
): Promise<Decimal | null> {
  const items = await prisma.priceListItem.findMany({ where: { priceListId, productId } });
  const window = resolveEffectivePrice(items, productId, onDate);
  return window ? new Decimal(window.price) : null;
}

/** Every effective price in a list on one date, for a whole cart. */
export async function effectivePricesFor(
  priceListId: string,
  onDate: Date = todayInCairo(),
): Promise<ReadonlyMap<string, Decimal>> {
  const items = await prisma.priceListItem.findMany({ where: { priceListId } });
  const effective = resolveEffectivePrices(items, onDate);
  return new Map([...effective].map(([productId, item]) => [productId, new Decimal(item.price)]));
}
