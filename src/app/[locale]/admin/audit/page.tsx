import { AuditAction } from '@prisma/client';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { formatDateTime } from '@/lib/format';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requirePermissionFor } from '@/server/auth/guard';
import { listAuditedEntityTypes, listAuditLog, type AuditRow } from '@/server/audit/queries';

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; action?: string; entityType?: string }>;
};

/** Per request: the list is the session's permission scope, not a static file. */
export const dynamic = 'force-dynamic';

export default async function AuditPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);

  const { session } = await requirePermissionFor(locale, PERMISSIONS.AUDIT_READ);

  const [page, entityTypes] = await Promise.all([
    listAuditLog({
      page: query.page ? Number(query.page) : 1,
      action: isAuditAction(query.action) ? query.action : 'ALL',
      entityType: query.entityType,
    }),
    listAuditedEntityTypes(),
  ]);

  const t = await getTranslations('audit');
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

          <Card className="mt-6">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>{t('title')}</CardTitle>
                <form
                  className="flex flex-wrap gap-2"
                  action={`/${locale}/admin/audit`}
                  method="get"
                >
                  <select
                    name="action"
                    defaultValue={query.action ?? 'ALL'}
                    aria-label={t('filterAction')}
                    className="rounded-card border border-surface-border bg-white px-3 py-1.5 text-sm"
                  >
                    <option value="ALL">{t('filterAction')}</option>
                    {Object.values(AuditAction).map((action) => (
                      <option key={action} value={action}>
                        {action}
                      </option>
                    ))}
                  </select>
                  <select
                    name="entityType"
                    defaultValue={query.entityType ?? ''}
                    aria-label={t('filterEntity')}
                    className="rounded-card border border-surface-border bg-white px-3 py-1.5 text-sm"
                  >
                    <option value="">{t('filterEntity')}</option>
                    {entityTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
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
                <a
                  href={buildAuditCsvHref(query)}
                  className="rounded-card border border-surface-border bg-white px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-muted"
                >
                  {t('export')}
                </a>
              </div>
            </CardHeader>

            <CardBody>
              {page.rows.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-subtle">{t('empty')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[48rem] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-surface-border text-xs text-ink-subtle">
                        <th className="p-2 text-start font-medium">{t('at')}</th>
                        <th className="p-2 text-start font-medium">{t('action')}</th>
                        <th className="p-2 text-start font-medium">{t('entity')}</th>
                        <th className="p-2 text-start font-medium">{t('actor')}</th>
                        <th className="p-2 text-start font-medium">{t('ip')}</th>
                        <th className="p-2 text-start font-medium">{t('details')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.rows.map((row) => (
                        <AuditRowView key={row.id} row={row} detailsLabel={t('details')} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {page.pageCount > 1 ? (
                <nav className="mt-4 flex items-center justify-between text-sm">
                  {page.page > 1 ? (
                    <a
                      href={buildAuditHref(locale, page.page - 1, query)}
                      className="text-brand-700 hover:underline"
                    >
                      {tCommon('back')}
                    </a>
                  ) : (
                    <span />
                  )}
                  <span className="text-ink-muted">
                    {t('pages', { page: page.page, total: page.pageCount })}
                  </span>
                  {page.page < page.pageCount ? (
                    <a
                      href={buildAuditHref(locale, page.page + 1, query)}
                      className="text-brand-700 hover:underline"
                    >
                      {tCommon('next')}
                    </a>
                  ) : (
                    <span />
                  )}
                </nav>
              ) : null}
            </CardBody>
          </Card>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}

function AuditRowView({ row, detailsLabel }: { row: AuditRow; detailsLabel: string }) {
  return (
    <tr className="border-b border-surface-border/60 align-top">
      <td className="p-2 text-xs whitespace-nowrap text-ink-muted">{formatDateTime(row.at)}</td>
      <td className="p-2">
        <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-2xs font-medium text-ink">
          {row.action}
        </span>
      </td>
      <td className="p-2 text-xs text-ink-muted">
        <div className="font-medium text-ink">{row.entityType}</div>
        <div dir="ltr" className="text-2xs text-ink-subtle">
          {row.entityId}
        </div>
      </td>
      <td className="p-2 text-xs text-ink-muted">{row.actorName ?? '—'}</td>
      <td className="p-2 text-xs text-ink-muted" dir="ltr">
        {row.ip ?? '—'}
      </td>
      <td className="p-2">
        {row.changes ? (
          <details className="text-xs">
            <summary className="cursor-pointer text-brand-700">{detailsLabel}</summary>
            <pre
              dir="ltr"
              className="mt-1 max-w-md overflow-x-auto rounded-md bg-surface-muted p-2 text-2xs"
            >
              {JSON.stringify(row.changes, null, 2)}
            </pre>
          </details>
        ) : (
          <span className="text-2xs text-ink-subtle">—</span>
        )}
      </td>
    </tr>
  );
}

function buildAuditCsvHref(query: { action?: string; entityType?: string }): string {
  const params = new URLSearchParams();
  if (query.action) params.set('action', query.action);
  if (query.entityType) params.set('entityType', query.entityType);
  const search = params.toString();
  return `/api/admin/audit.csv${search ? `?${search}` : ''}`;
}

function isAuditAction(value: string | undefined): value is AuditAction {
  return value !== undefined && (Object.values(AuditAction) as string[]).includes(value);
}

function buildAuditHref(
  locale: string,
  page: number,
  query: { action?: string; entityType?: string },
): string {
  const params = new URLSearchParams();
  params.set('page', String(page));
  if (query.action) params.set('action', query.action);
  if (query.entityType) params.set('entityType', query.entityType);
  return `/${locale}/admin/audit?${params.toString()}`;
}
