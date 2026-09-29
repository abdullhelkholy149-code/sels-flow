import { createNavigation } from 'next-intl/navigation';

import { routing } from '@/i18n/routing';

/**
 * Locale aware navigation helpers. Components must use these instead of
 * `next/link` so that the active locale prefix is always preserved.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
