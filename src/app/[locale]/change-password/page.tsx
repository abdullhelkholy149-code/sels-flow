import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { ChangePasswordForm } from '@/components/auth/change-password-form';
import { SiteFooter } from '@/components/layout/site-footer';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { getSessionUser } from '@/server/auth/session';
import { homePath, loginPath } from '@/server/auth/guard';

type PageProps = { params: Promise<{ locale: string }> };

/** Per request: the redirect decision depends on the session and its flags. */
export const dynamic = 'force-dynamic';

/**
 * Reachable while `must_change_password` is set, and only then: every other
 * protected screen redirects here, and this screen redirects out once the flag
 * is cleared.
 */
export default async function ChangePasswordPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSessionUser();
  if (!session) {
    redirect(loginPath(locale));
  }
  if (!session.mustChangePassword) {
    redirect(homePath(locale));
  }

  const t = await getTranslations('auth');

  return (
    <>
      <main className="flex flex-1 items-center py-10">
        <Container size="sm" className="max-w-md">
          <Card>
            <CardHeader>
              <CardTitle>{t('mustChangeTitle')}</CardTitle>
              <p className="text-sm text-ink-muted">{t('mustChangeSubtitle')}</p>
            </CardHeader>
            <CardBody>
              <ChangePasswordForm />
            </CardBody>
          </Card>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
