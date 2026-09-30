/**
 * The permission map is the core of RBAC, so these tests are exhaustive rather
 * than representative: a role silently losing a capability, or gaining one it
 * should never have, is the failure mode that matters.
 */
import { Role } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  ALL_ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  permissionsForRole,
  roleCan,
} from '@/lib/auth/permissions';

const allPermissions = Object.values(PERMISSIONS);

describe('permission map', () => {
  it('gives admin every permission', () => {
    for (const permission of allPermissions) {
      expect(roleCan(Role.ADMIN, permission)).toBe(true);
    }
  });

  it('has no duplicate permission strings', () => {
    expect(new Set(allPermissions).size).toBe(allPermissions.length);
  });

  it('grants nothing that is not a declared permission', () => {
    for (const role of ALL_ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(allPermissions).toContain(permission);
      }
    }
  });

  it('covers all five roles, including the ones enabled in phase 11', () => {
    expect([...ALL_ROLES].sort()).toEqual(
      ['ACCOUNTANT', 'ADMIN', 'CUSTOMER', 'REP', 'STOREKEEPER'].sort(),
    );
  });

  it('is frozen so no call site can mutate it at runtime', () => {
    expect(Object.isFrozen(ROLE_PERMISSIONS)).toBe(true);
  });
});

describe('rep', () => {
  it('can work his own book of business', () => {
    expect(roleCan(Role.REP, 'customers:read_own')).toBe(true);
    expect(roleCan(Role.REP, 'orders:decide')).toBe(true);
    expect(roleCan(Role.REP, 'payments:record')).toBe(true);
    expect(roleCan(Role.REP, 'visits:record')).toBe(true);
  });

  it('cannot reach other reps, all customers, users or settings', () => {
    expect(roleCan(Role.REP, 'reps:read_all')).toBe(false);
    expect(roleCan(Role.REP, 'customers:read_all')).toBe(false);
    expect(roleCan(Role.REP, 'users:read')).toBe(false);
    expect(roleCan(Role.REP, 'users:write')).toBe(false);
    expect(roleCan(Role.REP, 'settings:write')).toBe(false);
    expect(roleCan(Role.REP, 'audit:read')).toBe(false);
  });

  it('cannot issue an invoice or confirm a cash handover', () => {
    expect(roleCan(Role.REP, 'invoices:issue')).toBe(false);
    expect(roleCan(Role.REP, 'payments:confirm_handover')).toBe(false);
    expect(roleCan(Role.REP, 'stock:post_voucher')).toBe(false);
  });

  it('cannot grant a credit override', () => {
    expect(roleCan(Role.REP, 'credit:override_grant')).toBe(false);
  });
});

describe('customer', () => {
  it('can place orders, request returns and rate', () => {
    expect(roleCan(Role.CUSTOMER, 'orders:create_customer')).toBe(true);
    expect(roleCan(Role.CUSTOMER, 'returns:create')).toBe(true);
    expect(roleCan(Role.CUSTOMER, 'ratings:write')).toBe(true);
  });

  it('can read the catalog but not the price lists administration', () => {
    expect(roleCan(Role.CUSTOMER, 'catalog:read')).toBe(true);
    expect(roleCan(Role.CUSTOMER, 'pricing:read')).toBe(false);
    expect(roleCan(Role.CUSTOMER, 'pricing:write')).toBe(false);
  });

  it('cannot reach any back office surface', () => {
    for (const permission of [
      'users:read',
      'users:write',
      'settings:write',
      'audit:read',
      'reps:read_all',
      'customers:read_all',
      'customers:create',
      'orders:decide',
      'orders:deliver',
      'payments:record',
      'invoices:issue',
      'stock:receive',
      'returns:decide',
      'reports:read',
      'reps:read_self',
      'visits:record',
    ] as const) {
      expect(roleCan(Role.CUSTOMER, permission)).toBe(false);
    }
  });

  it('has no write access outside his own documents', () => {
    const writes = permissionsForRole(Role.CUSTOMER).filter((p) => p.endsWith(':write_all'));
    expect(writes).toHaveLength(0);
  });
});

describe('storekeeper', () => {
  it('covers the warehouse side', () => {
    expect(roleCan(Role.STOREKEEPER, 'stock:receive')).toBe(true);
    expect(roleCan(Role.STOREKEEPER, 'stock:issue')).toBe(true);
    expect(roleCan(Role.STOREKEEPER, 'stock:count')).toBe(true);
    expect(roleCan(Role.STOREKEEPER, 'stock:post_voucher')).toBe(true);
  });

  it('has no money access at all', () => {
    for (const permission of [
      'invoices:read_all',
      'invoices:issue',
      'payments:read_all',
      'payments:record',
      'payments:confirm_handover',
      'credit:read',
      'credit:override_grant',
      'credit_notes:issue',
    ] as const) {
      expect(roleCan(Role.STOREKEEPER, permission)).toBe(false);
    }
  });

  it('has no access to users, customers or settings', () => {
    expect(roleCan(Role.STOREKEEPER, 'users:read')).toBe(false);
    expect(roleCan(Role.STOREKEEPER, 'customers:read_all')).toBe(false);
    expect(roleCan(Role.STOREKEEPER, 'settings:write')).toBe(false);
  });
});

describe('accountant', () => {
  it('reads invoices, payments and reports', () => {
    expect(roleCan(Role.ACCOUNTANT, 'invoices:read_all')).toBe(true);
    expect(roleCan(Role.ACCOUNTANT, 'payments:read_all')).toBe(true);
    expect(roleCan(Role.ACCOUNTANT, 'reports:read')).toBe(true);
    expect(roleCan(Role.ACCOUNTANT, 'reports:export')).toBe(true);
  });

  it('confirms cash handovers and decides credit overrides', () => {
    expect(roleCan(Role.ACCOUNTANT, 'payments:confirm_handover')).toBe(true);
    expect(roleCan(Role.ACCOUNTANT, 'credit:override_grant')).toBe(true);
    expect(roleCan(Role.ACCOUNTANT, 'credit:override_reject')).toBe(true);
  });

  it('reads money but cannot create a payment', () => {
    expect(roleCan(Role.ACCOUNTANT, 'payments:record')).toBe(false);
  });

  it('cannot manage users or warehouse stock movements', () => {
    expect(roleCan(Role.ACCOUNTANT, 'users:write')).toBe(false);
    expect(roleCan(Role.ACCOUNTANT, 'users:reset_password')).toBe(false);
    expect(roleCan(Role.ACCOUNTANT, 'stock:issue')).toBe(false);
    expect(roleCan(Role.ACCOUNTANT, 'stock:count')).toBe(false);
  });
});

describe('least privilege', () => {
  it('keeps every non admin role strictly smaller than admin', () => {
    const adminSize = ROLE_PERMISSIONS[Role.ADMIN].length;
    for (const role of ALL_ROLES) {
      if (role === Role.ADMIN) continue;
      expect(ROLE_PERMISSIONS[role].length).toBeLessThan(adminSize);
    }
  });

  it('never lets two roles be identical', () => {
    const signatures = ALL_ROLES.map((role) => [...ROLE_PERMISSIONS[role]].sort().join('|'));
    expect(new Set(signatures).size).toBe(signatures.length);
  });
});
