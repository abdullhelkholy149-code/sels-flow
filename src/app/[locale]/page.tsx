import { getTranslations, setRequestLocale } from 'next-intl/server';

import { routing } from '@/i18n/routing';

import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { SystemStatus } from '@/components/system-status';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Container } from '@/components/ui/container';

type HomePageProps = { params: Promise<{ locale: string }> };

/**
 * The locale segment params are needed by this page, and Next.js only passes
 * `params` to a segment that declares `generateStaticParams` itself. The layout
 * declares it as well for its own use, so both levels are listed.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function HomePage({ params }: HomePageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('home');
  const tHealth = await getTranslations('health');
  const tPrivacy = await getTranslations('privacy');

  return (
    <>
      <SiteHeader />

      <main className="flex-1 py-10">
        <Container>
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold text-ink">{t('title')}</h1>
            <p className="text-sm text-ink-muted">{t('subtitle')}</p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>{t('phaseZeroTitle')}</CardTitle>
              </CardHeader>
              <CardBody>{t('phaseZeroBody')}</CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('nextTitle')}</CardTitle>
              </CardHeader>
              <CardBody>{t('nextBody')}</CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{tHealth('title')}</CardTitle>
              </CardHeader>
              <CardBody>
                <SystemStatus />
              </CardBody>
            </Card>
          </div>

          <p className="mt-8 rounded-card border border-surface-border bg-white p-4 text-sm text-ink-muted">
            {tPrivacy('gpsNotice')}
          </p>
        </Container>
      </main>

      <SiteFooter />
    </>
  );
}
