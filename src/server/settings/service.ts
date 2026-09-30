/**
 * Company settings service (Phase 1).
 *
 * The row is a singleton: `id` is pinned to 1, so there is exactly one set of
 * business defaults. Reading it is a single indexed lookup, which is why it can
 * be called from any screen that needs the VAT rate or a document prefix.
 */
import { prisma, type Tx } from '@/lib/prisma';

export interface CompanySettings {
  id: number;
  legalName: string;
  taxRegistrationNumber: string | null;
  branchCode: string | null;
  activityCode: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoPath: string | null;
  defaultVatRate: number;
  invoicePrefix: string;
  creditNotePrefix: string;
  orderPrefix: string;
  returnWindowDays: number;
  blockOnOverdue: boolean;
  overdueGraceDays: number;
  geofenceRadiusM: number;
  geofenceBlock: boolean;
  defaultMaxDiscountPercent: number;
  whatsappEnabled: boolean;
  defaultCreditDays: number;
  updatedAt: Date;
}

const SETTINGS_ID = 1;

type SettingsRow = Omit<CompanySettings, 'defaultVatRate' | 'defaultMaxDiscountPercent'> & {
  defaultVatRate: unknown;
  defaultMaxDiscountPercent: unknown;
};

function toSettings(row: SettingsRow): CompanySettings {
  return {
    ...row,
    // Prisma returns Decimal as an object-capable value; the UI and the money
    // helpers want a plain number, so it is converted once, here.
    defaultVatRate: Number(row.defaultVatRate),
    defaultMaxDiscountPercent: Number(row.defaultMaxDiscountPercent),
  };
}

export async function getCompanySettings(
  db: Tx | typeof prisma = prisma,
): Promise<CompanySettings> {
  const row = await db.companySettings.findUnique({ where: { id: SETTINGS_ID } });
  if (!row) {
    // The seed guarantees the row. A missing one means the database was never
    // seeded, which is a deployment error rather than a runtime condition, so it
    // is thrown loudly instead of silently defaulted.
    throw new Error('company settings row is missing: run `prisma db seed`');
  }
  return toSettings(row as SettingsRow);
}

/** The fields an admin may change from the settings screen. */
export interface SettingsInput {
  legalName: string;
  taxRegistrationNumber: string | null;
  branchCode: string | null;
  activityCode: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  defaultVatRate: number;
  invoicePrefix: string;
  creditNotePrefix: string;
  orderPrefix: string;
  returnWindowDays: number;
  blockOnOverdue: boolean;
  overdueGraceDays: number;
  geofenceRadiusM: number;
  geofenceBlock: boolean;
  defaultMaxDiscountPercent: number;
  whatsappEnabled: boolean;
  defaultCreditDays: number;
}

export async function updateCompanySettings(
  tx: Tx,
  input: SettingsInput,
): Promise<CompanySettings> {
  const row = await tx.companySettings.update({
    where: { id: SETTINGS_ID },
    data: input,
  });
  return toSettings(row as SettingsRow);
}
