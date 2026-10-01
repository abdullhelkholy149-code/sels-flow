import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  CreateCustomerForm,
  EditCustomerForm,
  CreditTermsForm,
  ReassignRepForm,
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
  listRepOptions,
} from '@/server/customers/queries';

type PageProps = {
  params: Promise<{ locale: string; id: string }>;
};

/**
 * The customer profile: master data, who is responsible now, who was before,
 * and every movement on the account.
 *
 * The scope check lives in `getCustomerScoped`, so a rep who types another rep's
 * customer id into the URL lands on the 404 page rather than on a page with an
 * error on it - a guessed id must not confirm that the record exists.
 *
 * Every panel is gated by permission, not by role name: an accountant may open
 * this profile to read a balance, and must not be offered the credit terms form
 * even though the form is on the page.
 */
export const dynamic = 'force-dynamic';

export default async function CustomerProfilePage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const { session, actor } = await requirePermissionFor(locale, PERMISSIONS.CUSTOMERS_READ_ALL);

  // `getCustomerScoped` answers `notFound()` for anything outside the reader's
  // scope, so by the time it returns there is a record and the page never has
  // to decide what to show for a missing one.
  const detail = await getCustomerDetail(actor, id);
  const customer = detail.customer;

  const canEdit =
    roleCan(actor.role, PERMISSIONS.CUSTOMERS_WRITE_ALL) ||
    roleCan(actor.role, PERMISSIONS.CUSTOMERS_WRITE_OWN);
  const canAssign = roleCan(actor.role, PERMISSIONS.CUSTOMERS_ASSIGN_REP);
  const canSetTerms = roleCan(actor.role, PERMISSIONS.CUSTOMERS_CREDIT_TERMS);
  const canCreate = roleCan(actor.role, PERMISSIONS.CUSTOMERS_CREATE);

  const [categories, priceLists, reps] = await Promise.all([
    listCustomerCategories(),
    listPriceListOptions(),
    listRepOptions(),
  ]);

  const t = await getTranslations('customers');
  const tCommon = await getTranslations('common');

  const categoryPicker: Option[] = categories.map((row) => ({ value: row.id, label: row.label }));
  const priceListPicker: Option[] = priceLists.map((row) => ({ value: row.id, label: row.label }));
  const repOptions: Option[] = reps.map((row) => ({ value: row.id, label: row.label }));

  const inCredit = detail.balance.isNegative();

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
            <p className="text-sm text-ink-muted">
              <span dir="ltr">{customer.code}</span>
              {customer.tradeName ? ` · ${customer.tradeName}` : ''}
            </p>
            <p className="text-xs text-ink-subtle">
              {tCommon('back')}:{' '}
              <a href={`/${locale}/admin/customers`} className="text-brand-700 hover:underline">
                {t('title')}
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
                  {inCredit ? (
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

          {customer.status === 'BLOCKED' ? (
            <p className="mt-4 rounded-card border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
              {t('blockedNotice')}
            </p>
          ) : null}

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
            ) : null}

            <div className="flex flex-col gap-4">
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

              {canAssign ? (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {t('assignmentTitle')}:{' '}
                      {detail.rep ? `${detail.rep.code} — ${detail.rep.name}` : '—'}
                    </CardTitle>
                  </CardHeader>
                  <CardBody>
                    <ReassignRepForm customerId={customer.id} reps={repOptions} />
                  </CardBody>
                </Card>
              ) : null}
            </div>
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
                  <table className="w-full min-w-[40rem] border-collapse text-sm">
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
                <table className="w-full min-w-[36rem] border-collapse text-sm">
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

          {canCreate ? (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>{t('createTitle')}</CardTitle>
              </CardHeader>
              <CardBody>
                <CreateCustomerForm
                  reps={repOptions}
                  categories={categoryPicker}
                  priceLists={priceListPicker}
                  defaultRepId={detail.rep?.id}
                />
              </CardBody>
            </Card>
          ) : null}
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
