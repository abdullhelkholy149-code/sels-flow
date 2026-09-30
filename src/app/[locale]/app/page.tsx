import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { PERMISSIONS, roleCan } from '@/lib/auth/permissions';
import { requireSession } from '@/server/auth/guard';

type PageProps = { params: Promise<{ locale: string }> };

/**
 * Rendered per request, and stated rather than inferred. The guard reads the
 * session cookie; if this were ever prerendered, the build time "no session"
 * result would be baked in and served to every visitor. Next.js does detect
 * `cookies()` today, but a guard that protects data should not depend on that
 * detection staying in place.
 */
export const dynamic = 'force-dynamic';

/**
 * The landing screen after sign-in. Every tile is gated by a permission rather
 * than a role name, so an admin, an accountant and a storekeeper all get the
 * same component with a different set of tiles.
 */
export default async function AppHomePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { session, actor } = await requireSession(locale);
  const t = await getTranslations('nav');
  const tDashboard = await getTranslations('dashboard');

  const tiles = [
    { href: '/admin/products', label: t('products'), permission: PERMISSIONS.CATALOG_READ },
    { href: '/admin/price-lists', label: t('priceLists'), permission: PERMISSIONS.PRICING_READ },
    { href: '/admin/users', label: t('users'), permission: PERMISSIONS.USERS_READ },
    { href: '/admin/audit', label: t('audit'), permission: PERMISSIONS.AUDIT_READ },
  ].filter((tile) => roleCan(actor.role, tile.permission));

  return (
    <>
      <SiteHeader
        user={{
          displayName: session.displayName,
          role: session.role,
          mustChangePassword: session.mustChangePassword,
        }}
      />
      <main className="flex-1 py-10">
        <Container size="sm">
          <h1 className="text-xl font-semibold text-ink">
            {tDashboard('welcome', { name: session.displayName })}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">{tDashboard('catalogBody')}</p>

          {tiles.length > 0 ? (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {tiles.map((tile) => (
                <Card key={tile.href}>
                  <CardHeader>
                    <CardTitle>
                      <a href={`/${locale}${tile.href}`} className="text-brand-700 hover:underline">
                        {tile.label}
                      </a>
                    </CardTitle>
                  </CardHeader>
                  <CardBody />
                </Card>
              ))}
            </div>
          ) : null}
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
