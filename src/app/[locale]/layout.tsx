import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { isLocale, routing } from '@/i18n/routing';
import { APP_NAME } from '@/lib/constants';

import '@/app/globals.css';

type LocaleParams = { params: Promise<{ locale: string }> };

type LocaleLayoutProps = LocaleParams & { children: React.ReactNode };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const dynamicParams = false;

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#216d4f',
};

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'app' });

  return {
    title: { default: t('name'), template: `%s | ${t('name')}` },
    description: t('tagline'),
    applicationName: APP_NAME,
    manifest: '/manifest.webmanifest',
    formatDetection: { telephone: false },
  };
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  // Enables static rendering of this locale subtree.
  setRequestLocale(locale);

  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <body className="min-h-screen bg-surface-muted">
        <NextIntlClientProvider>
          <div className="flex min-h-screen flex-col">{children}</div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
