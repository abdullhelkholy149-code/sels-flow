import { useTranslations } from 'next-intl';

import { Container } from '@/components/ui/container';
import { APP_NAME } from '@/lib/constants';

export function SiteFooter() {
  const t = useTranslations('footer');

  return (
    <footer className="mt-auto border-t border-surface-border bg-white">
      <Container>
        <div className="flex flex-col gap-1 py-6 text-sm text-ink-subtle">
          <span>
            {APP_NAME} — {t('builtWith')}
          </span>
          <span className="text-2xs">{t('version')} 0.1.0</span>
        </div>
      </Container>
    </footer>
  );
}
