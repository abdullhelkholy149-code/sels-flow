import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { CompanySettingsForm } from '@/components/settings/company-settings-form';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requirePermissionFor } from '@/server/auth/guard';
import { getCompanySettings } from '@/server/settings/service';

type PageProps = { params: Promise<{ locale: string }> };

/** Per request: the form is seeded with the current row. */
export const dynamic = 'force-dynamic';

/**
 * The settings screen. Gated on `settings:read` for the page and
 * `settings:write` for the form, so a read only role sees the current values
 * without a way to change them.
 */
export default async function CompanySettingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { session } = await requirePermissionFor(locale, PERMISSIONS.SETTINGS_READ);
  const settings = await getCompanySettings();

  const t = await getTranslations('settings');

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
              <CardTitle>{t('formTitle')}</CardTitle>
            </CardHeader>
            <CardBody>
              <CompanySettingsForm settings={settings} />
            </CardBody>
          </Card>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
