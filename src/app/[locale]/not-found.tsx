import { getTranslations } from 'next-intl/server';

import { Container } from '@/components/ui/container';
import { isLocale, routing } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';

/**
 * Next.js prerenders the not-found boundary without route params, so `params`
 * is optional here and the default locale is used when it is missing.
 */
type NotFoundProps = { params?: Promise<{ locale: string }> };

export default async function NotFound({ params }: NotFoundProps) {
  const requested = params ? (await params).locale : undefined;
  const locale = isLocale(requested) ? requested : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: 'notFound' });
  const tNav = await getTranslations({ locale, namespace: 'nav' });

  return (
    <main className="flex-1 py-16">
      <Container size="sm">
        <div className="card p-8 text-center">
          <p className="text-2xl font-semibold text-ink">404</p>
          <h1 className="mt-2 text-lg font-semibold text-ink">{t('title')}</h1>
          <p className="mt-2 text-sm text-ink-muted">{t('body')}</p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-md bg-brand-600 px-4 py-2 text-sm text-ink-inverse"
          >
            {tNav('home')}
          </Link>
        </div>
      </Container>
    </main>
  );
}
