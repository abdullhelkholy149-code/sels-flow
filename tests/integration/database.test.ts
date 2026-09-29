/**
 * Phase 0 integration tests.
 *
 * These run against a REAL PostgreSQL database (TEST_DATABASE_URL) with the
 * migrations already applied by tests/setup/global.ts. They are the only proof
 * that the generated SQL actually runs on PostgreSQL, and that the Prisma
 * client can talk to it.
 *
 * Everything here is read only except the audit round trip, which cleans up
 * after itself.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';

const EXPECTED_TABLES = [
  'users',
  'company_settings',
  'audit_logs',
  'document_counters',
  'reps',
  'customers',
] as const;

afterAll(async () => {
  await prisma.$disconnect();
});

describe('database connectivity', () => {
  it('answers a trivial query', async () => {
    await expect(prisma.$queryRaw`SELECT 1`).resolves.toBeDefined();
  });

  it('is a PostgreSQL server', async () => {
    const rows = await prisma.$queryRaw<Array<{ version: string }>>`SELECT version()`;
    expect(rows[0]?.version).toContain('PostgreSQL');
  });
});

describe('migrations', () => {
  it('created every Phase 0 table', async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `;
    const names = rows.map((row) => row.table_name);

    for (const table of EXPECTED_TABLES) {
      expect(names).toContain(table);
    }
  });

  it('is recorded as applied, not pending', async () => {
    const rows = await prisma.$queryRaw<Array<{ is_migration: boolean }>>`
      SELECT is_migration
      FROM _prisma_migrations
    `;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.is_migration)).toBe(true);
  });

  it('has no failed or rolled back migration', async () => {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)
      FROM _prisma_migrations
      WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL
    `;

    expect(Number(rows[0]?.count ?? 0)).toBe(0);
  });
});

describe('schema guarantees', () => {
  /**
   * Money is stored as NUMERIC and handled with decimal.js. A float column
   * anywhere in the schema would silently reintroduce rounding errors in
   * invoices, so this assertion is kept for every later phase too.
   */
  it('has no floating point columns', async () => {
    const rows = await prisma.$queryRaw<
      Array<{ table_name: string; column_name: string; data_type: string }>
    >`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND data_type IN ('real', 'double precision', 'money')
    `;

    expect(rows).toEqual([]);
  });

  it('keeps percentage columns as NUMERIC(5,2)', async () => {
    const rows = await prisma.$queryRaw<
      Array<{ data_type: string; numeric_precision: number | null; numeric_scale: number | null }>
    >`
      SELECT data_type, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'company_settings'
        AND column_name = 'default_vat_rate'
    `;
    const column = rows[0];

    expect(column?.data_type).toBe('numeric');
    expect(column?.numeric_precision).toBe(5);
    expect(column?.numeric_scale).toBe(2);
  });

  it('uses timestamptz for every timestamp', async () => {
    const rows = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND data_type LIKE '%timestamp%'
        AND data_type <> 'timestamp with time zone'
    `;

    expect(rows).toEqual([]);
  });

  it('created the Role enum used for permissions', async () => {
    const rows = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT enumlabel
      FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      WHERE pg_type.typname = 'Role'
      ORDER BY enumlabel
    `;

    expect(rows.map((row) => row.enumlabel)).toEqual([
      'ACCOUNTANT',
      'ADMIN',
      'CUSTOMER',
      'REP',
      'STOREKEEPER',
    ]);
  });
});

describe('prisma client round trip', () => {
  it('writes and reads back an audit log row', async () => {
    const marker = `phase0-integration-${Date.now()}`;

    const created = await prisma.auditLog.create({
      data: {
        action: 'CREATE',
        entityType: 'IntegrationTest',
        entityId: marker,
        metadata: { marker },
      },
    });

    try {
      const found = await prisma.auditLog.findUniqueOrThrow({ where: { id: created.id } });

      expect(found.entityType).toBe('IntegrationTest');
      expect(found.entityId).toBe(marker);
      expect(found.action).toBe('CREATE');
      // The timestamp comes from the database, not from JavaScript.
      expect(found.at).toBeInstanceOf(Date);
    } finally {
      await prisma.auditLog.delete({ where: { id: created.id } });
    }
  });
});
