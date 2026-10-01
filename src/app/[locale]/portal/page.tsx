import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { formatDate, formatMoney } from '@/lib/format';
import { requirePermissionFor } from '@/server/auth/guard';
import { getCustomerDetail } from '@/server/customers/queries';

type PageProps = { params: Promise<{ locale: string }> };

/**
 * The customer's own screen.
 *
 * Read-only by design, and not because a phase is missing: a customer changing
 * his own phone number or address would change who he is to the office, and a
 * customer changing his own credit limit would be writing his own terms. The
 * only writes a customer has are the ones the specification gives the role -
 * orders, returns, ratings and notifications - and those arrive in their phases.
 *
 * What the screen does give him is the number he actually needs: how much he
 * owes, and how much room is left before an order needs an office override.
 */
export const dynamic = 'force-dynamic';

export default async function PortalPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { session, actor } = await requirePermissionFor(locale, PERMISSIONS.CUSTOMERS_READ_OWN);

  // A rep also holds `customers:read_own`, but he has no customer record of his
  // own; `getCustomerScoped` returns `notFound()` for that, which is the honest
  // answer for "your profile" rather than an empty screen.
  const detail = actor.customerId ? await getCustomerDetail(actor, actor.customerId) : null;
  const customer = detail?.customer ?? null;

  const t = await getTranslations('customers');
  const tDashboard = await getTranslations('dashboard');

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
        <Container size="sm">
          <h1 className="text-xl font-semibold text-ink">{customer?.name ?? t('title')}</h1>
          <p className="mt-1 text-sm text-ink-muted">{tDashboard('catalogBody')}</p>

          {customer && detail ? (
            <>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <Card>
                  <CardBody>
                    <p className="text-xs text-ink-subtle">{t('balance')}</p>
                    <p className="text-lg font-semibold text-ink">
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
                    <p className="text-lg font-semibold text-ink">
                      {customer.paymentTerms === 'CREDIT'
                        ? formatMoney(detail.availableCredit)
                        : t('cash')}
                    </p>
                    {customer.paymentTerms === 'CREDIT' ? (
                      <p className="text-xs text-ink-subtle">
                        {t('creditLimit')}: {formatMoney(customer.creditLimit)}
                      </p>
                    ) : null}
                  </CardBody>
                </Card>
              </div>

              <Card className="mt-4">
                <CardHeader>
                  <CardTitle>{t('title')}</CardTitle>
                </CardHeader>
                <CardBody>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <dt className="text-ink-subtle">{t('code')}</dt>
                    <dd className="text-ink" dir="ltr">
                      {customer.code}
                    </dd>
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
                    <dt className="text-ink-subtle">{t('paymentTerms')}</dt>
                    <dd className="text-ink">
                      {customer.paymentTerms === 'CREDIT' ? t('credit') : t('cash')}
                    </dd>
                    <dt className="text-ink-subtle">{t('rep')}</dt>
                    <dd className="text-ink">{detail.rep?.name ?? '—'}</dd>
                  </dl>
                </CardBody>
              </Card>

              <Card className="mt-4">
                <CardHeader>
                  <CardTitle>{t('ledgerTitle')}</CardTitle>
                </CardHeader>
                <CardBody>
                  {detail.ledger.length === 0 ? (
                    <p className="py-6 text-center text-sm text-ink-subtle">{t('ledgerEmpty')}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-surface-border text-xs text-ink-subtle">
                            <th className="p-2 text-start font-medium">{t('entryType')}</th>
                            <th className="p-2 text-start font-medium">{t('debit')}</th>
                            <th className="p-2 text-start font-medium">{t('credit')}</th>
                            <th className="p-2 text-start font-medium">{t('balance')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.ledger.map((row) => (
                            <tr key={row.id} className="border-b border-surface-border/60">
                              <td className="p-2 text-ink">
                                {formatDate(row.at)} ·{' '}
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
            </>
          ) : null}
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
