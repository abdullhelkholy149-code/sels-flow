import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  CreateRepForm,
  EditRepForm,
  RepActiveToggleButton,
  RepDeleteButton,
} from '@/components/reps/rep-forms';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { formatDate, formatPercent } from '@/lib/format';
import { requirePermissionFor } from '@/server/auth/guard';
import { listReps } from '@/server/reps/queries';

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; search?: string; sort?: string; direction?: string }>;
};

/**
 * The office view of the rep book.
 *
 * Requires `reps:read_all`, so a rep never lands here: his own row is on his
 * profile, and a list of one row with a delete button on it is a page nobody
 * asked for. The customer count is the number of *open* assignment rows, which
 * is what decides whether the delete button is offered.
 */
export const dynamic = 'force-dynamic';

export default async function AdminRepsPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);

  const { session, actor } = await requirePermissionFor(locale, PERMISSIONS.REPS_READ_ALL);

  const page = await listReps(actor, {
    page: query.page ? Number(query.page) : 1,
    search: query.search,
    sort: query.sort,
    direction: query.direction === 'asc' ? 'asc' : query.direction === 'desc' ? 'desc' : undefined,
  });

  const t = await getTranslations('reps');
  const tCommon = await getTranslations('common');

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
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{t('results', { count: page.total })}</CardTitle>
                  <form className="flex gap-2" action={`/${locale}/admin/reps`} method="get">
                    <input
                      type="search"
                      name="search"
                      defaultValue={query.search ?? ''}
                      placeholder={t('searchPlaceholder')}
                      aria-label={tCommon('search')}
                      className="rounded-card border border-surface-border bg-white px-3 py-1.5 text-sm"
                    />
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
                    <table className="w-full min-w-[46rem] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-surface-border text-xs text-ink-subtle">
                          <th className="p-2 text-start font-medium">{t('code')}</th>
                          <th className="p-2 text-start font-medium">{t('name')}</th>
                          <th className="p-2 text-start font-medium">{t('phone')}</th>
                          <th className="p-2 text-start font-medium">{t('maxDiscountPercent')}</th>
                          <th className="p-2 text-start font-medium">{t('customerCount')}</th>
                          <th className="p-2 text-start font-medium">{t('hiredAt')}</th>
                          <th className="p-2 text-start font-medium">{tCommon('status')}</th>
                          <th className="p-2 text-start font-medium">{tCommon('actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {page.rows.map((rep) => (
                          <tr key={rep.id} className="border-b border-surface-border/60">
                            <td className="p-2 text-ink-muted" dir="ltr">
                              {rep.code}
                            </td>
                            <td className="p-2 font-medium text-ink">{rep.name}</td>
                            <td className="p-2 text-ink-muted" dir="ltr">
                              {rep.phone}
                            </td>
                            <td className="p-2 text-ink-muted">
                              {formatPercent(rep.maxDiscountPercent)}
                            </td>
                            <td className="p-2 text-ink-muted">{rep.customerCount}</td>
                            <td className="p-2 text-xs text-ink-muted">
                              {rep.hiredAt ? formatDate(rep.hiredAt) : '—'}
                            </td>
                            <td className="p-2">
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs ${
                                  rep.isActive
                                    ? 'bg-success-soft text-success'
                                    : 'bg-surface-sunken text-ink-muted'
                                }`}
                              >
                                {rep.isActive ? t('active') : t('inactive')}
                              </span>
                            </td>
                            <td className="p-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <RepActiveToggleButton repId={rep.id} isActive={rep.isActive} />
                                <RepDeleteButton repId={rep.id} customerCount={rep.customerCount} />
                                <details className="w-full">
                                  <summary className="cursor-pointer text-xs text-brand-700">
                                    {t('edit')}
                                  </summary>
                                  <div className="mt-3 max-w-sm">
                                    <EditRepForm
                                      repId={rep.id}
                                      name={rep.name}
                                      phone={rep.phone}
                                      username={rep.username}
                                      maxDiscountPercent={rep.maxDiscountPercent.toFixed(2)}
                                      hiredAt={
                                        rep.hiredAt ? rep.hiredAt.toISOString().slice(0, 10) : ''
                                      }
                                    />
                                  </div>
                                </details>
                              </div>
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
                        href={`/${locale}/admin/reps?page=${page.page - 1}${query.search ? `&search=${encodeURIComponent(query.search)}` : ''}`}
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
                        href={`/${locale}/admin/reps?page=${page.page + 1}${query.search ? `&search=${encodeURIComponent(query.search)}` : ''}`}
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

            <Card>
              <CardHeader>
                <CardTitle>{t('createTitle')}</CardTitle>
              </CardHeader>
              <CardBody>
                <CreateRepForm />
              </CardBody>
            </Card>
          </div>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
