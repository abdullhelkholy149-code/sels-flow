/**
 * Shared route protection for the authenticated app.
 *
 * Called at the top of every protected page. Order is deliberate:
 *
 *   no session -> login
 *   must change password -> change password, even for an admin
 *   missing permission -> 403 screen
 *
 * The password change gate comes before the permission check on purpose: a
 * rep created with a temporary password must not reach the admin screens even
 * to see that they are forbidden.
 */
import { redirect } from 'next/navigation';

import { routing } from '@/i18n/routing';
import { PERMISSIONS, type Permission } from '@/lib/auth/permissions';
import { getSessionUser, type SessionUser } from '@/server/auth/session';
import { loadActor, requirePermission, type Actor } from '@/server/data/access';

export interface ProtectedContext {
  session: SessionUser;
  actor: Actor;
}

export function loginPath(locale: string): string {
  return `/${locale}/login`;
}

export function changePasswordPath(locale: string): string {
  return `/${locale}/change-password`;
}

export function homePath(locale: string): string {
  // The signed in landing screen. The public page at `/${locale}` stays
  // reachable without a session.
  return `/${locale}/app`;
}

/**
 * Resolves the session or redirects to the login screen. The returned object is
 * what a page needs; nothing else should read the session cookie directly.
 */
export async function requireSession(locale: string): Promise<ProtectedContext> {
  const session = await getSessionUser();
  if (!session) {
    redirect(loginPath(locale));
  }
  if (session.mustChangePassword) {
    redirect(changePasswordPath(locale));
  }
  const actor = await loadActor(session);
  return { session, actor };
}

export async function requirePermissionFor(
  locale: string,
  permission: Permission,
): Promise<ProtectedContext> {
  const context = await requireSession(locale);
  requirePermission(context.actor, permission);
  return context;
}

/** Used by the login page itself: already signed in means go to the app. */
export async function redirectIfSignedIn(locale: string): Promise<SessionUser | null> {
  const session = await getSessionUser();
  if (!session) return null;
  if (session.mustChangePassword) {
    redirect(changePasswordPath(locale));
  }
  redirect(homePath(locale));
}

export function dashboardPath(locale: string, role: string): string {
  switch (role) {
    case 'ADMIN':
      return `/${locale}/admin`;
    case 'REP':
      return `/${locale}/rep`;
    case 'CUSTOMER':
      return `/${locale}/portal`;
    default:
      return `/${locale}/admin`;
  }
}

export { PERMISSIONS, routing };
