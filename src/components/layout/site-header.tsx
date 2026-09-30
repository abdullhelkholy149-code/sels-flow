import { useTranslations } from 'next-intl';

import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { UserMenu, type HeaderUser } from '@/components/layout/user-menu';
import { Container } from '@/components/ui/container';
import { Link } from '@/i18n/navigation';

export function SiteHeader({ user }: { user?: HeaderUser | null }) {
  const t = useTranslations('nav');
  const tApp = useTranslations('app');

  return (
    <header className="sticky top-0 z-10 border-b border-surface-border bg-white/90 backdrop-blur">
      <Container>
        <div className="flex h-16 items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 font-semibold text-ink">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 place-items-center rounded-md bg-brand-600 text-sm text-ink-inverse"
            >
              SF
            </span>
            <span className="flex flex-col text-start leading-tight">
              <span className="text-base">{tApp('name')}</span>
              <span className="text-2xs text-ink-subtle">{tApp('tagline')}</span>
            </span>
          </Link>

          <nav aria-label={t('home')} className="flex items-center gap-1">
            <Link
              href="/"
              className="rounded-md px-3 py-2 text-sm text-ink-muted hover:bg-surface-muted"
            >
              {t('home')}
            </Link>
            <LocaleSwitcher />
            {user ? <UserMenu user={user} /> : null}
          </nav>
        </div>
      </Container>
    </header>
  );
}
