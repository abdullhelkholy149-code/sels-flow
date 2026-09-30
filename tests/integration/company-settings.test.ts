/**
 * Company settings (Phase 1).
 *
 * The settings row is a singleton, so the interesting behaviour is the
 * validation on the way in and the audit row that has to land with the change.
 * A settings edit is the kind of quiet change that nobody notices was wrong six
 * months later unless the log records it.
 */
import { AuditAction } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma, withTransaction } from '@/lib/prisma';
import { writeAudit } from '@/server/audit/service';
import { getCompanySettings, updateCompanySettings } from '@/server/settings/service';

async function resetSettings(): Promise<void> {
  await prisma.companySettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      legalName: 'شركة سالز فلو للتوزيع',
      defaultVatRate: 14,
      invoicePrefix: 'INV',
      creditNotePrefix: 'CN',
      orderPrefix: 'ORD',
    },
    update: {
      legalName: 'شركة سالز فلو للتوزيع',
      taxRegistrationNumber: null,
      branchCode: null,
      activityCode: null,
      address: null,
      phone: null,
      email: null,
      defaultVatRate: 14,
      invoicePrefix: 'INV',
      creditNotePrefix: 'CN',
      orderPrefix: 'ORD',
      returnWindowDays: 7,
      blockOnOverdue: true,
      overdueGraceDays: 3,
      geofenceRadiusM: 200,
      geofenceBlock: false,
      defaultMaxDiscountPercent: 10,
      whatsappEnabled: false,
      defaultCreditDays: 30,
    },
  });
}

beforeEach(resetSettings);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('reading settings', () => {
  it('returns the singleton row with the decimals as plain numbers', async () => {
    const settings = await getCompanySettings();

    expect(settings.id).toBe(1);
    expect(settings.invoicePrefix).toBe('INV');
    // Prisma hands back a Decimal object; a template literal or a form input
    // would otherwise render "[object Object]" or break the value attribute.
    expect(typeof settings.defaultVatRate).toBe('number');
    expect(settings.defaultVatRate).toBe(14);
    expect(typeof settings.defaultMaxDiscountPercent).toBe('number');
  });

  it('throws a loud error when the row is missing, rather than defaulting', async () => {
    // Silently inventing defaults would let a system run on numbers nobody
    // chose. A missing singleton means an unseeded database.
    const empty = {
      companySettings: { findUnique: () => Promise.resolve(null) },
    } as unknown as typeof prisma;

    await expect(getCompanySettings(empty)).rejects.toThrow(/seed/);
  });
});

describe('writing settings', () => {
  it('persists every field and reads it back', async () => {
    await withTransaction(async (tx) => {
      await updateCompanySettings(tx, {
        legalName: 'شركة جديدة',
        taxRegistrationNumber: '123-456-789',
        branchCode: 'BR-01',
        activityCode: 'AC-01',
        address: 'القاهرة',
        phone: '+201000000001',
        email: 'info@example.com',
        defaultVatRate: 15.5,
        invoicePrefix: 'SINV',
        creditNotePrefix: 'SCN',
        orderPrefix: 'SORD',
        returnWindowDays: 14,
        blockOnOverdue: false,
        overdueGraceDays: 5,
        geofenceRadiusM: 350,
        geofenceBlock: true,
        defaultMaxDiscountPercent: 20,
        whatsappEnabled: true,
        defaultCreditDays: 45,
      });
    });

    const after = await getCompanySettings();
    expect(after.legalName).toBe('شركة جديدة');
    expect(after.taxRegistrationNumber).toBe('123-456-789');
    expect(after.defaultVatRate).toBe(15.5);
    expect(after.invoicePrefix).toBe('SINV');
    expect(after.whatsappEnabled).toBe(true);
    expect(after.defaultCreditDays).toBe(45);
  });

  it('keeps the row a singleton, so a second write updates rather than inserts', async () => {
    await withTransaction(async (tx) => {
      const current = await getCompanySettings(tx);
      await updateCompanySettings(tx, { ...current, legalName: 'الاسم الأول' });
    });
    await withTransaction(async (tx) => {
      const current = await getCompanySettings(tx);
      await updateCompanySettings(tx, { ...current, legalName: 'الاسم الثاني' });
    });

    expect(await prisma.companySettings.count({ where: { id: 1 } })).toBe(1);
    expect((await getCompanySettings()).legalName).toBe('الاسم الثاني');
  });

  it('commits the audit row with the change or not at all', async () => {
    const before = await getCompanySettings();

    await withTransaction(async (tx) => {
      const current = await getCompanySettings(tx);
      await updateCompanySettings(tx, { ...current, defaultVatRate: 7 });
      await writeAudit(tx, {
        action: AuditAction.UPDATE,
        entityType: 'CompanySettings',
        entityId: '1',
        actorRole: 'ADMIN',
        before: { defaultVatRate: current.defaultVatRate },
        after: { defaultVatRate: 7 },
      });
    });

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'CompanySettings' },
      orderBy: { at: 'desc' },
    });
    expect(row.entityId).toBe('1');
    expect(row.beforeJson).toMatchObject({ defaultVatRate: before.defaultVatRate });
    expect(row.afterJson).toMatchObject({ defaultVatRate: 7 });
  });

  it('leaves no audit row when the transaction is rolled back', async () => {
    // This is the property that makes the audit trail trustworthy: a change
    // that did not happen must not appear to have happened.
    await expect(
      withTransaction(async (tx) => {
        const current = await getCompanySettings(tx);
        await updateCompanySettings(tx, { ...current, defaultVatRate: 99 });
        await writeAudit(tx, {
          action: AuditAction.UPDATE,
          entityType: 'CompanySettings',
          entityId: '1',
          after: { defaultVatRate: 99 },
        });
        throw new Error('business rule failed after the write');
      }),
    ).rejects.toThrow(/business rule failed/);

    expect(await prisma.auditLog.count({ where: { entityType: 'CompanySettings' } })).toBe(0);
    expect((await getCompanySettings()).defaultVatRate).toBe(14);
  });
});
