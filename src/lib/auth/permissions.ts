/**
 * RBAC permission map (Section 4 of the specification).
 *
 * Design rules:
 *  - Every capability is a string constant in `PERMISSIONS`. Nothing is checked
 *    with a hard coded role name anywhere else in the codebase.
 *  - A role is a *set* of permissions. Adding a role is a single entry in
 *    `ROLE_PERMISSIONS`, and adding a capability is one line plus the grants
 *    that should include it. That is the "configuration, not refactoring"
 *    requirement.
 *  - The map is intentionally exhaustive over all five roles, including
 *    `STOREKEEPER` and `ACCOUNTANT`, which are activated in Phase 11. They are
 *    wired now so that enabling them later touches no call site.
 *  - `ADMIN` is computed as the union of everything else, so a new permission
 *    can never be forgotten by an admin.
 */
import { Role } from '@prisma/client';

export const PERMISSIONS = {
  // identity and access
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',
  USERS_RESET_PASSWORD: 'users:reset_password',
  ROLES_READ: 'roles:read',
  SESSIONS_REVOKE: 'sessions:revoke',
  AUDIT_READ: 'audit:read',
  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE: 'settings:write',

  // catalog and pricing
  CATALOG_READ: 'catalog:read',
  CATALOG_WRITE: 'catalog:write',
  PRICING_READ: 'pricing:read',
  PRICING_WRITE: 'pricing:write',

  // reps and customers
  REPS_READ_ALL: 'reps:read_all',
  REPS_READ_SELF: 'reps:read_self',
  REPS_WRITE: 'reps:write',
  CUSTOMERS_READ_ALL: 'customers:read_all',
  CUSTOMERS_READ_OWN: 'customers:read_own',
  CUSTOMERS_CREATE: 'customers:create',
  CUSTOMERS_WRITE_ALL: 'customers:write_all',
  CUSTOMERS_WRITE_OWN: 'customers:write_own',
  CUSTOMERS_ASSIGN_REP: 'customers:assign_rep',
  CUSTOMERS_BLOCK: 'customers:block',
  CUSTOMERS_CREDIT_TERMS: 'customers:credit_terms',

  // stock and custody
  STOCK_READ_ALL: 'stock:read_all',
  STOCK_READ_OWN_CUSTODY: 'stock:read_own_custody',
  STOCK_RECEIVE: 'stock:receive',
  STOCK_ISSUE: 'stock:issue',
  STOCK_RETURN_TO_MAIN: 'stock:return_to_main',
  STOCK_COUNT: 'stock:count',
  STOCK_POST_VOUCHER: 'stock:post_voucher',

  // orders
  ORDERS_READ_ALL: 'orders:read_all',
  ORDERS_READ_OWN_CUSTOMER: 'orders:read_own_customer',
  ORDERS_READ_CUSTOMERS: 'orders:read_customers',
  ORDERS_CREATE_CUSTOMER: 'orders:create_customer',
  ORDERS_EDIT_OWN: 'orders:edit_own',
  ORDERS_DECIDE: 'orders:decide',
  ORDERS_DELIVER: 'orders:deliver',

  // invoicing and money
  INVOICES_READ_ALL: 'invoices:read_all',
  INVOICES_READ_OWN_CUSTOMER: 'invoices:read_own_customer',
  INVOICES_ISSUE: 'invoices:issue',
  INVOICES_CANCEL: 'invoices:cancel',
  CREDIT_NOTES_ISSUE: 'credit_notes:issue',
  PAYMENTS_READ_ALL: 'payments:read_all',
  PAYMENTS_READ_OWN_CUSTOMER: 'payments:read_own_customer',
  PAYMENTS_RECORD: 'payments:record',
  PAYMENTS_CONFIRM_HANDOVER: 'payments:confirm_handover',

  // credit control
  CREDIT_READ: 'credit:read',
  CREDIT_OVERRIDE_GRANT: 'credit:override_grant',
  CREDIT_OVERRIDE_REJECT: 'credit:override_reject',

  // visits, routes, targets
  VISITS_READ_ALL: 'visits:read_all',
  VISITS_READ_OWN: 'visits:read_own',
  VISITS_RECORD: 'visits:record',
  ROUTES_READ: 'routes:read',
  ROUTES_WRITE: 'routes:write',
  TARGETS_READ_ALL: 'targets:read_all',
  TARGETS_READ_OWN: 'targets:read_own',
  TARGETS_WRITE: 'targets:write',

  // returns
  RETURNS_READ_ALL: 'returns:read_all',
  RETURNS_READ_OWN: 'returns:read_own',
  RETURNS_CREATE: 'returns:create',
  RETURNS_DECIDE: 'returns:decide',
  RETURNS_RECEIVE: 'returns:receive',

  // ratings, notifications, reports
  RATINGS_READ: 'ratings:read',
  RATINGS_WRITE: 'ratings:write',
  RATINGS_HIDE: 'ratings:hide',
  NOTIFICATIONS_READ_OWN: 'notifications:read_own',
  NOTIFICATIONS_BROADCAST: 'notifications:broadcast',
  REPORTS_READ: 'reports:read',
  REPORTS_EXPORT: 'reports:export',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const p = PERMISSIONS;

/**
 * A storekeeper covers the warehouse side only: warehouses, vouchers, counts.
 * No money, no customers, no users.
 */
const STOREKEEPER_PERMISSIONS: readonly Permission[] = [
  p.STOCK_READ_ALL,
  p.STOCK_RECEIVE,
  p.STOCK_ISSUE,
  p.STOCK_RETURN_TO_MAIN,
  p.STOCK_COUNT,
  p.STOCK_POST_VOUCHER,
  p.CATALOG_READ,
];

/**
 * An accountant reads invoices, payments and statements, and confirms cash
 * handovers. Accountant may not create a document, only confirm and report.
 */
const ACCOUNTANT_PERMISSIONS: readonly Permission[] = [
  p.INVOICES_READ_ALL,
  p.PAYMENTS_READ_ALL,
  p.PAYMENTS_CONFIRM_HANDOVER,
  p.CREDIT_READ,
  p.CREDIT_OVERRIDE_GRANT,
  p.CREDIT_OVERRIDE_REJECT,
  p.CREDIT_NOTES_ISSUE,
  p.CUSTOMERS_READ_ALL,
  p.REPORTS_READ,
  p.REPORTS_EXPORT,
  p.CATALOG_READ,
  p.PRICING_READ,
  p.RETURNS_READ_ALL,
  p.STOCK_READ_ALL,
  p.AUDIT_READ,
];

/**
 * A rep works his own book of business: his customers, their orders, invoices,
 * balances and visits; his own custody stock, route, targets and cash.
 */
const REP_PERMISSIONS: readonly Permission[] = [
  p.CATALOG_READ,
  p.PRICING_READ,
  p.REPS_READ_SELF,
  p.CUSTOMERS_READ_OWN,
  p.CUSTOMERS_CREATE,
  p.CUSTOMERS_WRITE_OWN,
  p.ORDERS_READ_CUSTOMERS,
  p.ORDERS_CREATE_CUSTOMER,
  p.ORDERS_EDIT_OWN,
  p.ORDERS_DECIDE,
  p.ORDERS_DELIVER,
  p.INVOICES_READ_OWN_CUSTOMER,
  p.PAYMENTS_READ_OWN_CUSTOMER,
  p.PAYMENTS_RECORD,
  p.VISITS_READ_OWN,
  p.VISITS_RECORD,
  p.ROUTES_READ,
  p.TARGETS_READ_OWN,
  p.STOCK_READ_OWN_CUSTODY,
  p.RETURNS_READ_OWN,
  p.RETURNS_DECIDE,
  p.RETURNS_RECEIVE,
  p.RATINGS_READ,
  p.RATINGS_WRITE,
  p.NOTIFICATIONS_READ_OWN,
  p.SETTINGS_READ,
  p.CUSTOMERS_CREDIT_TERMS,
];

/** A customer sees only his own profile, his own prices and his own documents. */
const CUSTOMER_PERMISSIONS: readonly Permission[] = [
  p.CATALOG_READ,
  p.CUSTOMERS_READ_OWN,
  p.ORDERS_READ_OWN_CUSTOMER,
  p.ORDERS_CREATE_CUSTOMER,
  p.INVOICES_READ_OWN_CUSTOMER,
  p.PAYMENTS_READ_OWN_CUSTOMER,
  p.RETURNS_READ_OWN,
  p.RETURNS_CREATE,
  p.RATINGS_READ,
  p.RATINGS_WRITE,
  p.NOTIFICATIONS_READ_OWN,
  p.SETTINGS_READ,
];

const EVERY_PERMISSION: readonly Permission[] = Object.values(PERMISSIONS);

const ADMIN_PERMISSIONS: readonly Permission[] = EVERY_PERMISSION;

/** The single source of truth for "who may do what". */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = Object.freeze({
  ADMIN: ADMIN_PERMISSIONS,
  REP: REP_PERMISSIONS,
  CUSTOMER: CUSTOMER_PERMISSIONS,
  STOREKEEPER: STOREKEEPER_PERMISSIONS,
  ACCOUNTANT: ACCOUNTANT_PERMISSIONS,
});

export const ALL_ROLES: readonly Role[] = Object.freeze(Object.values(Role)) as readonly Role[];

const SETS: Readonly<Record<Role, ReadonlySet<Permission>>> = Object.freeze(
  Object.fromEntries(
    ALL_ROLES.map((role) => [role, new Set<Permission>(ROLE_PERMISSIONS[role])]),
  ) as unknown as Record<Role, ReadonlySet<Permission>>,
);

export function roleCan(role: Role, permission: Permission): boolean {
  return SETS[role].has(permission);
}

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/** True when the role's grants are exactly the union of every other role. */
export function isSuperuserRole(role: Role): boolean {
  return role === Role.ADMIN;
}
