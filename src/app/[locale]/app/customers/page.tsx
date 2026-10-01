import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CreateCustomerForm, type Option } from '@/components/customers/customer-forms';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { PERMISSIONS, roleCan } from '@/lib/auth/permissions';
import { formatMoney } from '@/lib/format';
import { requirePermissionFor } from '@/server/auth/guard';
import {
  customerCounts,
  listCustomerCategories,
  listCustomers,
  listPriceListOptions,
} from '@/server/customers/queries';

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
};

/**
 * The rep's own book of business.
 *
 * The list is the rep's scope and nothing else: `listCustomers` filters on the
 * open assignment rows, so a customer the office moved to a colleague is gone
 * from this screen the moment the move is made. The rep picker in the create
 * form is passed as his own id, which is also what the service enforces - the
 * form cannot offer a colleague, and the action would refuse the id anyway.
 *
 * A customer role also holds `customers:read_own`, so this page is readable by a
 * customer; the create form is gated separately because that role has no
 * `customers:create`.
 */
export const dynamic = 'force-dynamic';

export default async function RepCustomersPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);

  const { session, actor } = await requirePermissionFor(locale, PERMISSIONS.CUSTOMERS_READ_OWN);

  const page = await listCustomers(actor, {
    page: query.page ? Number(query.page) : 1,
    search: query.search,
    status: query.status,
  });

  const canCreate = roleCan(actor.role, PERMISSIONS.CUSTOMERS_CREATE);

  const [counts, categories, priceLists] = await Promise.all([
    customerCounts(actor),
    listCustomerCategories(),
    listPriceListOptions(),
  ]);

  const t = await getTranslations('customers');
  const tCommon = await getTranslations('common');

  const categoryPicker: Option[] = categories.map((row) => ({ value: row.id, label: row.label }));
  const priceListPicker: Option[] = priceLists.map((row) => ({ value: row.id, label: row.label }));

  // A rep assigns to himself, so the picker holds exactly one option.
  const repOptions: Option[] = actor.repId
    ? [{ value: actor.repId, label: session.displayName }]
    : [];

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
            <h1 className="text-xl font-semibold text-ink">{t('myCustomers')}</h1>
            <p className="text-sm text-ink-muted">{t('results', { count: counts.total })}</p>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{t('results', { count: page.total })}</CardTitle>
                  <form
                    className="flex flex-wrap gap-2"
                    action={`/${locale}/app/customers`}
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
                    <table className="w-full min-w-[40rem] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-surface-border text-xs text-ink-subtle">
                          <th className="p-2 text-start font-medium">{t('code')}</th>
                          <th className="p-2 text-start font-medium">{t('name')}</th>
                          <th className="p-2 text-start font-medium">{t('phone')}</th>
                          <th className="p-2 text-start font-medium">{t('paymentTerms')}</th>
                          <th className="p-2 text-start font-medium">{tCommon('status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {page.rows.map((row) => (
                          <tr key={row.id} className="border-b border-surface-border/60">
                            <td className="p-2 text-ink-muted" dir="ltr">
                              {row.code}
                            </td>
                            <td className="p-2 font-medium text-ink">
                              <a
                                href={`/${locale}/app/customers/${row.id}`}
                                className="text-brand-700 hover:underline"
                              >
                                {row.name}
                              </a>
                              {row.city ? (
                                <div className="text-xs text-ink-subtle">{row.city}</div>
                              ) : null}
                            </td>
                            <td className="p-2 text-ink-muted" dir="ltr">
                              {row.phone ?? '—'}
                            </td>
                            <td className="p-2 text-ink-muted">
                              {row.paymentTerms === 'CREDIT' ? t('credit') : t('cash')}
                              {row.paymentTerms === 'CREDIT' ? (
                                <div className="text-xs text-ink-subtle">
                                  {formatMoney(row.creditLimit)}
                                </div>
                              ) : null}
                            </td>
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
                        href={`/${locale}/app/customers?page=${page.page - 1}${query.search ? `&search=${encodeURIComponent(query.search)}` : ''}`}
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
                        href={`/${locale}/app/customers?page=${page.page + 1}${query.search ? `&search=${encodeURIComponent(query.search)}` : ''}`}
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

            {canCreate ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('createTitle')}</CardTitle>
                </CardHeader>
                <CardBody>
                  <CreateCustomerForm
                    reps={repOptions}
                    categories={categoryPicker}
                    priceLists={priceListPicker}
                    defaultRepId={actor.repId ?? undefined}
                  />
                </CardBody>
              </Card>
            ) : null}
          </div>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
