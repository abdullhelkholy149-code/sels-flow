import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ChangePasswordForm } from '@/components/auth/change-password-form';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { requireSession } from '@/server/auth/guard';

type PageProps = { params: Promise<{ locale: string }> };

/** Per request: the screen is behind a session guard. */
export const dynamic = 'force-dynamic';

/** The same form once the account is settled, reached from the header menu. */
export default async function AccountSecurityPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { session } = await requireSession(locale);
  const t = await getTranslations('auth');

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
          <Card>
            <CardHeader>
              <CardTitle>{t('changePasswordLink')}</CardTitle>
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
