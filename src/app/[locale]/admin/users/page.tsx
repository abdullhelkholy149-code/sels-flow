import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  ActiveToggleButton,
  CreateUserForm,
  ResetPasswordButton,
} from '@/components/auth/user-forms';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { formatDateTime } from '@/lib/format';
import { requirePermissionFor } from '@/server/auth/guard';
import { listUsers, type UserRow } from '@/server/users/queries';

/** A next-intl translator, narrowed to what these components call. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; search?: string; sort?: string; direction?: string }>;
};

/**
 * Dynamic by design, and stated rather than inferred. The list depends on the
 * session: prerendering it would bake one visitor's rows into a static file and
 * serve them to everyone.
 */
export const dynamic = 'force-dynamic';

export default async function UsersPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);

  const { actor } = await requirePermissionFor(locale, PERMISSIONS.USERS_READ);

  const page = await listUsers({
    page: query.page ? Number(query.page) : 1,
    search: query.search,
    sort: query.sort,
    direction: query.direction === 'asc' ? 'asc' : query.direction === 'desc' ? 'desc' : undefined,
  });

  const t = await getTranslations('users');
  const tRoles = await getTranslations('roles');
  const tCommon = await getTranslations('common');

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
                  <div className="flex flex-wrap items-center gap-2">
                    <form className="flex gap-2" action={`/${locale}/admin/users`} method="get">
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
                    <a
                      href={buildUsersCsvHref(query.search)}
                      className="rounded-card border border-surface-border bg-white px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-muted"
                    >
                      {tCommon('exportCsv')}
                    </a>
                  </div>
                </div>
              </CardHeader>

              <CardBody>
                {page.rows.length === 0 ? (
                  <p className="py-8 text-center text-sm text-ink-subtle">{t('empty')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[46rem] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-surface-border text-start text-xs text-ink-subtle">
                          <SortHeader
                            field="name"
                            label={t('name')}
                            locale={locale}
                            query={query}
                            search={query.search}
                          />
                          <SortHeader
                            field="role"
                            label={t('role')}
                            locale={locale}
                            query={query}
                            search={query.search}
                          />
                          <SortHeader
                            field="phone"
                            label={t('phone')}
                            locale={locale}
                            query={query}
                            search={query.search}
                          />
                          <SortHeader
                            field="isActive"
                            label={t('status')}
                            locale={locale}
                            query={query}
                            search={query.search}
                          />
                          <SortHeader
                            field="lastLoginAt"
                            label={t('lastLogin')}
                            locale={locale}
                            query={query}
                            search={query.search}
                          />
                          <th className="p-2 text-start font-medium">{t('actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {page.rows.map((user) => (
                          <UserRowView
                            key={user.id}
                            user={user}
                            isSelf={user.id === actor.userId}
                            t={t}
                            tRoles={tRoles}
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
                    t={t}
                  />
                ) : null}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('createTitle')}</CardTitle>
              </CardHeader>
              <CardBody>
                <CreateUserForm />
              </CardBody>
            </Card>
          </div>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}

/**
 * A column header that links to the same list sorted by that column. Clicking
 * the active column flips the direction. Only the fields the query allows are
 * ever emitted, so the sort is a fixed vocabulary rather than a column name
 * passed through to Prisma.
 */
function SortHeader({
  field,
  label,
  locale,
  query,
  search,
}: {
  field: string;
  label: string;
  locale: string;
  query: { sort?: string; direction?: string };
  search: string | undefined;
}) {
  const active = query.sort === field;
  const direction = active && query.direction === 'asc' ? 'desc' : 'asc';
  const params = new URLSearchParams();
  params.set('sort', field);
  params.set('direction', direction);
  if (search) params.set('search', search);

  return (
    // `aria-sort` belongs on the header cell, not on the link inside it.
    <th
      className="p-2 text-start font-medium"
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : ('none' as const)}
    >
      <a
        href={`/${locale}/admin/users?${params.toString()}`}
        className="inline-flex items-center gap-1 hover:text-ink"
      >
        {label}
        <span aria-hidden="true" className="text-2xs">
          {active ? (direction === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </a>
    </th>
  );
}

function buildUsersCsvHref(search: string | undefined): string {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  const query = params.toString();
  return `/api/admin/users.csv${query ? `?${query}` : ''}`;
}

function UserRowView({
  user,
  isSelf,
  t,
  tRoles,
}: {
  user: UserRow;
  isSelf: boolean;
  t: Translate;
  tRoles: Translate;
}) {
  const status = !user.isActive ? t('inactive') : user.locked ? t('locked') : t('active');
  const statusClass = !user.isActive
    ? 'bg-surface-sunken text-ink-muted'
    : user.locked
      ? 'bg-warning-soft text-warning'
      : 'bg-success-soft text-success';

  return (
    <tr className="border-b border-surface-border/60">
      <td className="p-2">
        <div className="font-medium text-ink">{user.name}</div>
        {user.username ? (
          <div dir="ltr" className="text-xs text-ink-subtle">
            @{user.username}
          </div>
        ) : null}
        {user.mustChangePassword ? (
          <div className="text-xs text-warning">{t('temporaryPasswordHint')}</div>
        ) : null}
      </td>
      <td className="p-2 text-ink-muted">{tRoles(user.role)}</td>
      <td className="p-2 text-ink-muted" dir="ltr">
        {user.phone}
      </td>
      <td className="p-2">
        <span className={`rounded-full px-2 py-0.5 text-xs ${statusClass}`}>{status}</span>
      </td>
      <td className="p-2 text-xs text-ink-muted">
        {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : t('never')}
      </td>
      <td className="p-2">
        <div className="flex flex-wrap items-center gap-2">
          <ResetPasswordButton userId={user.id} />
          <ActiveToggleButton userId={user.id} isActive={user.isActive} isSelf={isSelf} />
        </div>
      </td>
    </tr>
  );
}

function Pager({
  locale,
  page,
  pageCount,
  search,
  t,
}: {
  locale: string;
  page: number;
  pageCount: number;
  search: string | undefined;
  t: Translate;
}) {
  const build = (target: number) => {
    const params = new URLSearchParams();
    params.set('page', String(target));
    if (search) params.set('search', search);
    return `/${locale}/admin/users?${params.toString()}`;
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
