'use client';

import type { Role } from '@prisma/client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { CsrfField } from '@/components/ui/form';
import { PERMISSIONS, roleCan, type Permission } from '@/lib/auth/permissions';
import { cn } from '@/lib/cn';
import { Link } from '@/i18n/navigation';
import { logoutAction } from '@/server/auth/actions';

export interface HeaderUser {
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
}

interface NavItem {
  href: string;
  label: string;
  permission: Permission;
}

/**
 * Account menu. Rendered only when a session exists; the server decides that,
 * the client only displays it.
 *
 * The admin entries are gated by the permission map rather than by a role name,
 * so a role that is granted `USERS_READ` later gets the link with no change here,
 * and a role that loses it loses the link.
 */
export function UserMenu({ user }: { user: HeaderUser }) {
  const t = useTranslations('auth');
  const tNav = useTranslations('nav');
  const tRoles = useTranslations('roles');
  const [open, setOpen] = useState(false);

  const items: NavItem[] = [
    { href: '/admin/products', label: tNav('products'), permission: PERMISSIONS.CATALOG_READ },
    { href: '/admin/price-lists', label: tNav('priceLists'), permission: PERMISSIONS.PRICING_READ },
    { href: '/admin/users', label: tNav('users'), permission: PERMISSIONS.USERS_READ },
    { href: '/admin/audit', label: tNav('audit'), permission: PERMISSIONS.AUDIT_READ },
    { href: '/admin/settings', label: tNav('settings'), permission: PERMISSIONS.SETTINGS_WRITE },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-muted hover:bg-surface-muted"
      >
        <span
          aria-hidden="true"
          className="grid h-7 w-7 place-items-center rounded-full bg-brand-100 text-2xs font-semibold text-brand-800"
        >
          {user.displayName.slice(0, 2)}
        </span>
        <span className="hidden sm:flex sm:flex-col sm:items-start sm:leading-tight">
          <span className="text-xs font-medium text-ink">{user.displayName}</span>
          <span className="text-2xs text-ink-subtle">{tRoles(user.role as never)}</span>
        </span>
      </button>

      {open ? (
        <>
          {/* Clicking the backdrop closes the menu without a library. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div
            role="menu"
            className={cn(
              'absolute z-20 mt-2 w-56 rounded-card border border-surface-border bg-white p-1 shadow-pop',
              // Direction aware: the panel hangs off the inline end of the button.
              'end-0',
            )}
          >
            <p className="px-3 py-2 text-2xs text-ink-subtle">{t('signedInAs')}</p>

            <Link
              href="/account/security"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-2 text-sm text-ink hover:bg-surface-muted"
            >
              {t('changePasswordLink')}
            </Link>

            {items
              .filter((item) => roleCan(user.role, item.permission))
              .map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-3 py-2 text-sm text-ink hover:bg-surface-muted"
                >
                  {item.label}
                </Link>
              ))}

            <form action={logoutAction} className="border-t border-surface-border pt-1">
              <CsrfField />
              <button
                type="submit"
                role="menuitem"
                className="block w-full rounded-md px-3 py-2 text-start text-sm text-danger hover:bg-danger-soft"
              >
                {t('logout')}
              </button>
            </form>
          </div>
        </>
      ) : null}
    </div>
  );
}
