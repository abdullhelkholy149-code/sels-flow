import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  CreditTermsForm,
  EditCustomerForm,
  type Option,
} from '@/components/customers/customer-forms';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { PERMISSIONS, roleCan } from '@/lib/auth/permissions';
import { formatDate, formatMoney } from '@/lib/format';
import { requirePermissionFor } from '@/server/auth/guard';
import {
  getCustomerDetail,
  listCustomerCategories,
  listPriceListOptions,
} from '@/server/customers/queries';

type PageProps = {
  params: Promise<{ locale: string; id: string }>;
};

/**
 * The rep's view of one of his customers.
 *
 * Same `getCustomerDetail` as the office screen, so the scope decision is made
 * once: `getCustomerScoped` raises `notFound()` for a customer that is not this
 * rep's, and the rep's browser sees an ordinary 404 page rather than a screen
 * that says "you are not allowed" - which would confirm the record exists.
 *
 * The write panels are gated by permission, not by the fact that the page is the
 * rep's screen: reassignment and blocking stay with the office because those are
 * not his decisions to make about his own book.
 */
export const dynamic = 'force-dynamic';

export default async function RepCustomerProfilePage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const { session, actor } = await requirePermissionFor(locale, PERMISSIONS.CUSTOMERS_READ_OWN);

  const detail = await getCustomerDetail(actor, id);
  const customer = detail.customer;

  const canEdit =
    roleCan(actor.role, PERMISSIONS.CUSTOMERS_WRITE_ALL) ||
    roleCan(actor.role, PERMISSIONS.CUSTOMERS_WRITE_OWN);
  const canSetTerms = roleCan(actor.role, PERMISSIONS.CUSTOMERS_CREDIT_TERMS);

  const [categories, priceLists] = await Promise.all([
    listCustomerCategories(),
    listPriceListOptions(),
  ]);

  const t = await getTranslations('customers');
  const tCommon = await getTranslations('common');

  const categoryPicker: Option[] = categories.map((row) => ({ value: row.id, label: row.label }));
  const priceListPicker: Option[] = priceLists.map((row) => ({ value: row.id, label: row.label }));

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
            <h1 className="text-xl font-semibold text-ink">{customer.name}</h1>
            <p className="text-sm text-ink-muted" dir="ltr">
              {customer.code}
              {customer.tradeName ? ` · ${customer.tradeName}` : ''}
            </p>
            <p className="text-xs text-ink-subtle">
              {tCommon('back')}:{' '}
              <a href={`/${locale}/app/customers`} className="text-brand-700 hover:underline">
                {t('myCustomers')}
              </a>
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Card>
              <CardBody>
                <p className="text-xs text-ink-subtle">{tCommon('status')}</p>
                <p className="text-sm font-medium text-ink">
                  {customer.status === 'BLOCKED'
                    ? t('blocked')
                    : customer.status === 'ACTIVE'
                      ? t('active')
                      : t('inactive')}
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="text-xs text-ink-subtle">{t('balance')}</p>
                <p className="text-sm font-medium text-ink">
                  {formatMoney(detail.balance)}
                  {detail.balance.isNegative() ? (
                    <span className="ms-2 text-xs text-success">{t('inCredit')}</span>
                  ) : null}
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="text-xs text-ink-subtle">{t('creditLimit')}</p>
                <p className="text-sm font-medium text-ink">
                  {customer.paymentTerms === 'CREDIT'
                    ? `${formatMoney(customer.creditLimit)} · ${formatMoney(detail.availableCredit)}`
                    : t('cash')}
                </p>
              </CardBody>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {canEdit ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('editTitle')}</CardTitle>
                </CardHeader>
                <CardBody>
                  <EditCustomerForm
                    customerId={customer.id}
                    categories={categoryPicker}
                    priceLists={priceListPicker}
                    defaults={{
                      name: customer.name,
                      tradeName: customer.tradeName ?? undefined,
                      contactPerson: customer.contactPerson ?? undefined,
                      phone: customer.phone ?? undefined,
                      address: customer.address ?? undefined,
                      governorate: customer.governorate ?? undefined,
                      city: customer.city ?? undefined,
                      categoryId: customer.categoryId ?? undefined,
                      priceListId: customer.priceListId ?? undefined,
                      receiverType: customer.receiverType,
                      taxRegistrationNumber: customer.taxRegistrationNumber ?? undefined,
                      nationalId: customer.nationalId ?? undefined,
                      notes: customer.notes ?? undefined,
                      whatsappOptIn: customer.whatsappOptIn,
                    }}
                  />
                </CardBody>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>{t('editTitle')}</CardTitle>
                </CardHeader>
                <CardBody>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <dt className="text-ink-subtle">{t('phone')}</dt>
                    <dd className="text-ink" dir="ltr">
                      {customer.phone ?? '—'}
                    </dd>
                    <dt className="text-ink-subtle">{t('address')}</dt>
                    <dd className="text-ink">{customer.address ?? '—'}</dd>
                    <dt className="text-ink-subtle">{t('city')}</dt>
                    <dd className="text-ink">{customer.city ?? '—'}</dd>
                    <dt className="text-ink-subtle">{t('governorate')}</dt>
                    <dd className="text-ink">{customer.governorate ?? '—'}</dd>
                    <dt className="text-ink-subtle">{t('notes')}</dt>
                    <dd className="text-ink">{customer.notes ?? '—'}</dd>
                  </dl>
                </CardBody>
              </Card>
            )}

            {canSetTerms ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('creditTermsTitle')}</CardTitle>
                </CardHeader>
                <CardBody>
                  <CreditTermsForm
                    customerId={customer.id}
                    paymentTerms={customer.paymentTerms}
                    creditLimit={customer.creditLimit.toFixed(2)}
                    creditDays={customer.creditDays}
                  />
                </CardBody>
              </Card>
            ) : null}
          </div>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{t('ledgerTitle')}</CardTitle>
            </CardHeader>
            <CardBody>
              {detail.ledger.length === 0 ? (
                <p className="py-6 text-center text-sm text-ink-subtle">{t('ledgerEmpty')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-surface-border text-xs text-ink-subtle">
                        <th className="p-2 text-start font-medium">{tCommon('status')}</th>
                        <th className="p-2 text-start font-medium">{t('entryType')}</th>
                        <th className="p-2 text-start font-medium">{t('debit')}</th>
                        <th className="p-2 text-start font-medium">{t('credit')}</th>
                        <th className="p-2 text-start font-medium">{t('balance')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.ledger.map((row) => (
                        <tr key={row.id} className="border-b border-surface-border/60">
                          <td className="p-2 text-xs text-ink-muted">{formatDate(row.at)}</td>
                          <td className="p-2 text-ink">
                            {row.entryType === 'OPENING' ? t('opening') : row.entryType}
                          </td>
                          <td className="p-2 text-ink-muted">{formatMoney(row.debit)}</td>
                          <td className="p-2 text-ink-muted">{formatMoney(row.credit)}</td>
                          <td className="p-2 font-medium text-ink">
                            {formatMoney(row.balanceAfter)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{t('assignmentHistory')}</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-surface-border text-xs text-ink-subtle">
                      <th className="p-2 text-start font-medium">{t('rep')}</th>
                      <th className="p-2 text-start font-medium">{t('assignedFrom')}</th>
                      <th className="p-2 text-start font-medium">{t('assignedTo')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.assignments.map((row) => (
                      <tr key={row.id} className="border-b border-surface-border/60">
                        <td className="p-2 text-ink">
                          {row.repCode} — {row.repName}
                        </td>
                        <td className="p-2 text-ink-muted">{formatDate(row.fromDate)}</td>
                        <td className="p-2 text-ink-muted">
                          {row.toDate ? formatDate(row.toDate) : t('open')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
