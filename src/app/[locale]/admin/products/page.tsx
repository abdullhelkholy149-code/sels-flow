import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  CategoryList,
  CreateCategoryForm,
  CreateProductForm,
  CreateUnitForm,
  DeleteProductButton,
  EditProductForm,
  ProductActiveToggle,
  UnitList,
  type EditableProduct,
  type Option,
} from '@/components/catalog/catalog-forms';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { PERMISSIONS, roleCan } from '@/lib/auth/permissions';
import { DEFAULT_VAT_RATE_PERCENT } from '@/lib/constants';
import { formatQuantity } from '@/lib/format';
import { requirePermissionFor } from '@/server/auth/guard';
import {
  listProductCategories,
  listProducts,
  listUnits,
  type ProductRow,
} from '@/server/catalog/queries';

type Translate = (key: string, values?: Record<string, string | number>) => string;

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    page?: string;
    search?: string;
    category?: string;
    sort?: string;
    direction?: string;
  }>;
};

/** The list is per session and changes with every write, so it is never cached. */
export const dynamic = 'force-dynamic';

export default async function ProductsPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);

  const { actor } = await requirePermissionFor(locale, PERMISSIONS.CATALOG_READ);
  // Read and write are separate permissions: a viewer may look at the catalog
  // without being able to change it, and the create forms simply do not render.
  const canWrite = roleCan(actor.role, PERMISSIONS.CATALOG_WRITE);

  const [page, categories, units] = await Promise.all([
    listProducts({
      page: query.page ? Number(query.page) : 1,
      search: query.search,
      categoryId: query.category,
      sort: query.sort,
      direction:
        query.direction === 'asc' ? 'asc' : query.direction === 'desc' ? 'desc' : undefined,
    }),
    listProductCategories(),
    listUnits(),
  ]);

  const t = await getTranslations('catalog');
  const tCommon = await getTranslations('common');

  const categoryOptions = categories.map<Option>((category) => ({
    value: category.id,
    label: category.name,
  }));
  const unitOptions = units.map<Option>((unit) => ({ value: unit.id, label: unit.name }));

  return (
    <>
      <SiteHeader />
      <main className="flex-1 py-8">
        <Container size="lg">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold text-ink">{t('title')}</h1>
            <p className="text-sm text-ink-muted">{t('subtitle')}</p>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{t('results', { count: page.total })}</CardTitle>
                  <form
                    className="flex flex-wrap gap-2"
                    action={`/${locale}/admin/products`}
                    method="get"
                  >
                    <input
                      type="search"
                      name="search"
                      defaultValue={query.search ?? ''}
                      placeholder={t('searchPlaceholder')}
                      aria-label={tCommon('search')}
                      className="rounded-card border border-surface-border bg-white px-3 py-1.5 text-sm"
                    />
                    <select
                      name="category"
                      defaultValue={query.category ?? ''}
                      aria-label={t('filterByCategory')}
                      className="rounded-card border border-surface-border bg-white px-3 py-1.5 text-sm"
                    >
                      <option value="">{t('allCategories')}</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded-card border border-surface-border bg-white px-3 py-1.5 text-sm"
                    >
                      {tCommon('search')}
                    </button>
                  </form>
                </div>
              </CardHeader>

              <CardBody>
                {page.rows.length === 0 ? (
                  <p className="py-8 text-center text-sm text-ink-subtle">{t('empty')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[48rem] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-surface-border text-start text-xs text-ink-subtle">
                          <th className="p-2 text-start font-medium">{t('productCode')}</th>
                          <th className="p-2 text-start font-medium">{t('productNameAr')}</th>
                          <th className="p-2 text-start font-medium">{t('category')}</th>
                          <th className="p-2 text-start font-medium">{t('unit')}</th>
                          <th className="p-2 text-start font-medium">{t('packSize')}</th>
                          <th className="p-2 text-start font-medium">{t('vatRate')}</th>
                          <th className="p-2 text-start font-medium">{t('costPrice')}</th>
                          <th className="p-2 text-start font-medium">{t('status')}</th>
                          {canWrite ? (
                            <th className="p-2 text-start font-medium">{t('actions')}</th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {page.rows.map((product) => (
                          <ProductRowView
                            key={product.id}
                            product={product}
                            categories={categoryOptions}
                            units={unitOptions}
                            canWrite={canWrite}
                            t={t}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {page.pageCount > 1 ? (
                  <Pager
                    locale={locale}
                    page={page.page}
                    pageCount={page.pageCount}
                    search={query.search}
                    category={query.category}
                    t={t}
                  />
                ) : null}
              </CardBody>
            </Card>

            <div className="flex flex-col gap-4">
              {canWrite ? (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>{t('createProduct')}</CardTitle>
                    </CardHeader>
                    <CardBody>
                      <CreateProductForm
                        categories={categoryOptions}
                        units={unitOptions}
                        defaultVatRate={DEFAULT_VAT_RATE_PERCENT}
                      />
                    </CardBody>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>{t('createCategory')}</CardTitle>
                    </CardHeader>
                    <CardBody>
                      {canWrite ? <CategoryList categories={categories} /> : null}
                      <CreateCategoryForm />
                    </CardBody>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>{t('createUnit')}</CardTitle>
                    </CardHeader>
                    <CardBody>
                      {canWrite ? <UnitList units={units} /> : null}
                      <CreateUnitForm />
                    </CardBody>
                  </Card>
                </>
              ) : (
                <Card>
                  <CardBody>
                    <p className="py-4 text-center text-sm text-ink-subtle">{t('readOnly')}</p>
                  </CardBody>
                </Card>
              )}
            </div>
          </div>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}

function ProductRowView({
  product,
  categories,
  units,
  canWrite,
  t,
}: {
  product: ProductRow;
  categories: Option[];
  units: Option[];
  canWrite: boolean;
  t: Translate;
}) {
  const editable: EditableProduct = {
    id: product.id,
    code: product.code,
    nameAr: product.nameAr,
    nameEn: product.nameEn ?? '',
    categoryId: product.categoryId,
    unitId: product.unitId,
    packSize: product.packSize ? product.packSize.toString() : '',
    vatRate: product.vatRate.toFixed(2),
    costPrice: product.costPrice ? product.costPrice.toFixed(2) : '',
    isActive: product.isActive,
  };

  return (
    <tr className="border-b border-surface-border/60">
      <td className="p-2 font-medium text-ink" dir="ltr">
        {product.code}
      </td>
      <td className="p-2 text-ink">
        <div>{product.nameAr}</div>
        {product.nameEn ? (
          <div dir="ltr" className="text-xs text-ink-subtle">
            {product.nameEn}
          </div>
        ) : null}
      </td>
      <td className="p-2 text-ink-muted">{product.categoryName}</td>
      <td className="p-2 text-ink-muted">{product.unitName}</td>
      <td className="p-2 text-ink-muted" dir="ltr">
        {product.packSize ? formatQuantity(product.packSize) : '—'}
      </td>
      <td className="p-2 text-ink-muted" dir="ltr">
        {product.vatRate.toFixed(2)}%
      </td>
      <td className="p-2 text-ink-muted" dir="ltr">
        {product.costPrice ? product.costPrice.toFixed(2) : '—'}
      </td>
      <td className="p-2">
        <span
          className={
            product.isActive
              ? 'rounded-full bg-success-soft px-2 py-0.5 text-xs text-success'
              : 'rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-ink-muted'
          }
        >
          {product.isActive ? t('active') : t('inactive')}
        </span>
      </td>
      {canWrite ? (
        <td className="p-2">
          <div className="flex flex-wrap items-start gap-2">
            <ProductActiveToggle productId={product.id} isActive={product.isActive} />
            <EditProductForm product={editable} categories={categories} units={units} />
            <DeleteProductButton productId={product.id} />
          </div>
        </td>
      ) : null}
    </tr>
  );
}

function Pager({
  locale,
  page,
  pageCount,
  search,
  category,
  t,
}: {
  locale: string;
  page: number;
  pageCount: number;
  search: string | undefined;
  category: string | undefined;
  t: Translate;
}) {
  const build = (target: number) => {
    const params = new URLSearchParams();
    params.set('page', String(target));
    if (search) params.set('search', search);
    if (category) params.set('category', category);
    return `/${locale}/admin/products?${params.toString()}`;
  };

  return (
    <nav className="mt-4 flex items-center justify-between text-sm" aria-label="pagination">
      {page > 1 ? (
        <a href={build(page - 1)} className="text-brand-700 hover:underline">
          {t('prev')}
        </a>
      ) : (
        <span />
      )}
      <span className="text-ink-muted">{t('pages', { page, total: pageCount })}</span>
      {page < pageCount ? (
        <a href={build(page + 1)} className="text-brand-700 hover:underline">
          {t('next')}
        </a>
      ) : (
        <span />
      )}
    </nav>
  );
}
