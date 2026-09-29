'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

type HealthPayload = {
  status: 'ok' | 'degraded';
  checks: { database: 'up' | 'down' };
};

/** Reads the health endpoint. Rendered client side so the page stays static. */
export function SystemStatus() {
  const t = useTranslations('health');
  const [state, setState] = useState<{ pending: true } | { pending: false; data: HealthPayload }>({
    pending: true,
  });

  useEffect(() => {
    let cancelled = false;

    fetch('/api/health', { cache: 'no-store' })
      .then((response) => response.json() as Promise<HealthPayload>)
      .then((data) => {
        if (!cancelled) setState({ pending: false, data });
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            pending: false,
            data: { status: 'degraded', checks: { database: 'down' } },
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.pending) {
    return <p className="text-sm text-ink-subtle">{t('title')}: ...</p>;
  }

  const healthy = state.data.status === 'ok';

  return (
    <div className="flex flex-col gap-1">
      <p className={healthy ? 'text-sm font-medium text-success' : 'text-sm font-medium text-danger'}>
        {healthy ? t('ok') : t('degraded')}
      </p>
      <p className="text-sm text-ink-muted">
        {state.data.checks.database === 'up' ? t('databaseUp') : t('databaseDown')}
      </p>
    </div>
  );
}
