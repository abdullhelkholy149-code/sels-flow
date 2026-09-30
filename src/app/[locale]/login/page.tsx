import { getTranslations, setRequestLocale } from 'next-intl/server';

import { LoginForm } from '@/components/auth/login-form';
import { SiteFooter } from '@/components/layout/site-footer';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { redirectIfSignedIn } from '@/server/auth/guard';
import { ensureAnonymousCsrfCookie } from '@/server/auth/session';

type PageProps = { params: Promise<{ locale: string }> };

/**
 * Per request: the page seeds the anonymous CSRF cookie and redirects a visitor
 * who already has a session, so a prerendered copy would serve one visitor's
 * answer to everybody.
 */
export const dynamic = 'force-dynamic';

export default async function LoginPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  // An authenticated visitor never sees the login screen.
  await redirectIfSignedIn(locale);

  // Seeds the anonymous CSRF pair. The cookie is set while the page renders and
  // copied into the form, so a cross site post cannot fill the field.
  await ensureAnonymousCsrfCookie();

  const t = await getTranslations('auth');
  const tApp = await getTranslations('app');

  return (
    <>
      <main className="flex flex-1 items-center py-10">
        <Container className="max-w-md">
          <div className="mb-6 text-center">
            <h1 className="text-xl font-semibold text-ink">{tApp('name')}</h1>
            <p className="mt-1 text-sm text-ink-muted">{tApp('tagline')}</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('loginTitle')}</CardTitle>
              <p className="text-sm text-ink-muted">{t('loginSubtitle')}</p>
            </CardHeader>
            <CardBody>
              <LoginForm locale={locale} />
            </CardBody>
          </Card>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
