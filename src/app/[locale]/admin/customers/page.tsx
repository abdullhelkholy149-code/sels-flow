import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  CategoryRow,
  CreateCategoryForm,
  type CategoryOption,
} from '@/components/customers/category-forms';
import {
  CreateCustomerForm,
  CustomerRowActions,
  type Option,
} from '@/components/customers/customer-forms';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { PERMISSIONS, roleCan } from '@/lib/auth/permissions';
import { formatDate, formatMoney } from '@/lib/format';
import { requirePermissionFor } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import {
  customerCounts,
  listCustomerCategories,
  listCustomers,
  listPriceListOptions,
  listRepOptions,
} from '@/server/customers/queries';

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    page?: string;
    search?: string;
    status?: string;
    categoryId?: string;
    sort?: string;
    direction?: string;
  }>;
};

/**
 * The office view of the customer book.
 *
 * Reads require `customers:read_all`; the write buttons are gated separately, so
 * an accountant who may read the book to settle a balance is not offered the
 * buttons to change it. Every list below goes through `listCustomers`, which
 * applies the scope again on the server - the page's own filter is a convenience,
 * never the control.
 */
export const dynamic = 'force-dynamic';

export default async function AdminCustomersPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);

  const { session, actor } = await requirePermissionFor(locale, PERMISSIONS.CUSTOMERS_READ_ALL);

  const page = await listCustomers(actor, {
    page: query.page ? Number(query.page) : 1,
    search: query.search,
    status: query.status,
    categoryId: query.categoryId,
    sort: query.sort,
    direction: query.direction === 'asc' ? 'asc' : query.direction === 'desc' ? 'desc' : undefined,
  });

  const [counts, categories, priceLists, reps] = await Promise.all([
    customerCounts(actor),
    listCustomerCategories(),
    listPriceListOptions(),
    listRepOptions(),
  ]);

  // The category card needs the number of customers on each one; the option
  // list has no counts and the page has no reason to fetch them twice.
  const categoryRows = await prisma.customerCategory.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
    include: { _count: { select: { customers: { where: { deletedAt: null } } } } },
  });
  const categoryOptions: CategoryOption[] = categoryRows.map((row) => ({
    id: row.id,
    name: row.name,
    nameEn: row.nameEn,
    customerCount: row._count.customers,
  }));

  const t = await getTranslations('customers');
  const tCommon = await getTranslations('common');

  const repOptions: Option[] = reps.map((rep) => ({ value: rep.id, label: rep.label }));
  const categoryPicker: Option[] = categories.map((row) => ({ value: row.id, label: row.label }));
  const priceListPicker: Option[] = priceLists.map((row) => ({ value: row.id, label: row.label }));

  const canBlock = roleCan(actor.role, PERMISSIONS.CUSTOMERS_BLOCK);
  const canDelete = roleCan(actor.role, PERMISSIONS.CUSTOMERS_WRITE_ALL);

  return (
    <>
      <SiteHeader
        user={{
          displayName: session.displayName,
          role: session.role,
          mustChangePassword: session.mustChangePassword,
        }}
      />
      <main className="flex-1 py-8">
        <Container size="lg">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold text-ink">{t('title')}</h1>
            <p className="text-sm text-ink-muted">{t('subtitle')}</p>
            <p className="text-xs text-ink-subtle">
              {tCommon('total')}: {counts.total} · {t('active')}: {counts.active} · {t('blocked')}:{' '}
              {counts.blocked}
            </p>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{t('results', { count: page.total })}</CardTitle>
                  <form
                    className="flex flex-wrap gap-2"
                    action={`/${locale}/admin/customers`}
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
                      name="status"
                      defaultValue={query.status ?? ''}
                      aria-label={t('filterByStatus')}
                      className="rounded-card border border-surface-border bg-white px-2 py-1.5 text-sm"
                    >
                      <option value="">{t('allStatuses')}</option>
                      <option value="ACTIVE">{t('active')}</option>
                      <option value="BLOCKED">{t('blocked')}</option>
                      <option value="INACTIVE">{t('inactive')}</option>
                    </select>
                    <select
                      name="categoryId"
                      defaultValue={query.categoryId ?? ''}
                      aria-label={t('filterByCategory')}
                      className="rounded-card border border-surface-border bg-white px-2 py-1.5 text-sm"
                    >
                      <option value="">{t('allCategories')}</option>
                      {categoryPicker.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
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
                    <table className="w-full min-w-[52rem] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-surface-border text-start text-xs text-ink-subtle">
                          <th className="p-2 text-start font-medium">{t('code')}</th>
                          <th className="p-2 text-start font-medium">{t('name')}</th>
                          <th className="p-2 text-start font-medium">{t('phone')}</th>
                          <th className="p-2 text-start font-medium">{t('rep')}</th>
                          <th className="p-2 text-start font-medium">{t('paymentTerms')}</th>
                          <th className="p-2 text-start font-medium">{t('creditLimit')}</th>
                          <th className="p-2 text-start font-medium">{tCommon('status')}</th>
                          <th className="p-2 text-start font-medium">{tCommon('actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {page.rows.map((row) => (
                          <tr key={row.id} className="border-b border-surface-border/60">
                            <td className="p-2 text-ink-muted" dir="ltr">
                              {row.code}
                            </td>
                            <td className="p-2">
                              <a
                                href={`/${locale}/admin/customers/${row.id}`}
                                className="font-medium text-brand-700 hover:underline"
                              >
                                {row.name}
                              </a>
                              {row.tradeName ? (
                                <div className="text-xs text-ink-subtle">{row.tradeName}</div>
                              ) : null}
                              {row.city || row.governorate ? (
                                <div className="text-xs text-ink-subtle">
                                  {[row.city, row.governorate].filter(Boolean).join(' - ')}
                                </div>
                              ) : null}
                            </td>
                            <td className="p-2 text-ink-muted" dir="ltr">
                              {row.phone ?? '—'}
                            </td>
                            <td className="p-2 text-ink-muted">
                              {row.repName ? `${row.repCode} — ${row.repName}` : '—'}
                            </td>
                            <td className="p-2 text-ink-muted">
                              {row.paymentTerms === 'CREDIT' ? t('credit') : t('cash')}
                              {row.paymentTerms === 'CREDIT' ? (
                                <div className="text-xs text-ink-subtle">
                                  {row.creditDays} {t('creditDays')}
                                </div>
                              ) : null}
                            </td>
                            <td className="p-2 text-ink-muted">{formatMoney(row.creditLimit)}</td>
                            <td className="p-2">
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs ${
                                  row.status === 'BLOCKED'
                                    ? 'bg-danger-soft text-danger'
                                    : row.status === 'ACTIVE'
                                      ? 'bg-success-soft text-success'
                                      : 'bg-surface-sunken text-ink-muted'
                                }`}
                              >
                                {row.status === 'BLOCKED'
                                  ? t('blocked')
                                  : row.status === 'ACTIVE'
                                    ? t('active')
                                    : t('inactive')}
                              </span>
                            </td>
                            <td className="p-2">
                              <CustomerRowActions
                                customerId={row.id}
                                status={row.status}
                                canBlock={canBlock}
                                canDelete={canDelete}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {page.pageCount > 1 ? (
                  <nav
                    className="mt-4 flex items-center justify-between text-sm"
                    aria-label="pagination"
                  >
                    {page.page > 1 ? (
                      <a
                        href={`/${locale}/admin/customers?${keepFilters({ ...query, page: String(page.page - 1) })}`}
                        className="text-brand-700 hover:underline"
                      >
                        {t('prev')}
                      </a>
                    ) : (
                      <span />
                    )}
                    <span className="text-ink-muted">
                      {t('pages', { page: page.page, total: page.pageCount })}
                    </span>
                    {page.page < page.pageCount ? (
                      <a
                        href={`/${locale}/admin/customers?${keepFilters({ ...query, page: String(page.page + 1) })}`}
                        className="text-brand-700 hover:underline"
                      >
                        {t('next')}
                      </a>
                    ) : (
                      <span />
                    )}
                  </nav>
                ) : null}
              </CardBody>
            </Card>

            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>{t('createTitle')}</CardTitle>
                </CardHeader>
                <CardBody>
                  <CreateCustomerForm
                    reps={repOptions}
                    categories={categoryPicker}
                    priceLists={priceListPicker}
                  />
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('categoriesTitle')}</CardTitle>
                </CardHeader>
                <CardBody>
                  <CreateCategoryForm />
                  {categoryOptions.length > 0 ? (
                    <table className="mt-4 w-full border-collapse text-sm">
                      <tbody>
                        {categoryOptions.map((category) => (
                          <CategoryRow key={category.id} category={category} />
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                  <p className="mt-4 text-xs text-ink-subtle">
                    {t('categoriesTitle')} · {formatDate(new Date())}
                  </p>
                </CardBody>
              </Card>
            </div>
          </div>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}

/** Keeps the current filters when paging, so page 2 is not page 2 of everything. */
function keepFilters(query: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value && key !== 'page') search.set(key, value);
  }
  return search.toString();
}
