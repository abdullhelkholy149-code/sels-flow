/**
 * Customer reads (Phase 3).
 *
 * Every list here is filtered through `customerScope` before anything else, so a
 * rep's screen and a rep's *query* agree on who he may see. The UI's own idea of
 * "my customers" is never the control (Section 4).
 *
 * The current rep is read through the assignment rows that have no `to_date`,
 * which is the same condition the scope uses, so the list can never show a
 * customer whose current rep the reader is not.
 */
import { CustomerStatus, PaymentTerms, type Customer, type Prisma } from '@prisma/client';

import { Decimal } from '@/lib/format';
import { prisma } from '@/lib/prisma';
import {
  customerScope,
  getCustomerScoped,
  paginate,
  requireOneOf,
  safeOrderBy,
  type Actor,
  type ListQuery,
  type Page,
} from '@/server/data/access';
import { ledgerBalance } from '@/server/customers/rules';

const SORTABLE = ['code', 'name', 'status', 'createdAt'] as const;
type Sortable = (typeof SORTABLE)[number];

const CUSTOMER_STATUSES = ['ACTIVE', 'BLOCKED', 'INACTIVE'] as const;

export interface CustomerRow {
  id: string;
  code: string;
  name: string;
  tradeName: string | null;
  phone: string | null;
  governorate: string | null;
  city: string | null;
  status: CustomerStatus;
  paymentTerms: PaymentTerms;
  creditLimit: Decimal;
  creditDays: number;
  categoryName: string | null;
  priceListName: string | null;
  repId: string | null;
  repName: string | null;
  repCode: string | null;
  createdAt: Date;
}

export interface CustomerListFilters extends ListQuery {
  search?: string;
  status?: string;
  categoryId?: string;
}

/** The assignment fragment that names the customer's one current rep. */
const CURRENT_REP_INCLUDE = {
  where: { toDate: null },
  take: 1,
  include: { rep: { select: { id: true, code: true, name: true } } },
} as const;

export async function listCustomers(
  actor: Actor,
  query: CustomerListFilters,
): Promise<Page<CustomerRow>> {
  const search = query.search?.trim();
  const and: Prisma.CustomerWhereInput[] = [customerScope(actor)];

  if (query.status !== undefined && query.status !== '') {
    and.push({ status: requireOneOf<CustomerStatus>(query.status, CUSTOMER_STATUSES) });
  }
  if (query.categoryId !== undefined && query.categoryId !== '') {
    and.push({ categoryId: query.categoryId });
  }
  if (search) {
    // `mode: 'insensitive'` is the reason a rep typing "café" or a code in a
    // different case still finds the row.
    and.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { tradeName: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
      ],
    });
  }

  const where: Prisma.CustomerWhereInput = { AND: and };
  const orderBy = safeOrderBy<Sortable>(SORTABLE, query.sort, query.direction, {
    createdAt: 'desc',
  });

  return paginate<CustomerRow>(
    query,
    () => prisma.customer.count({ where }),
    async ({ skip, take }) => {
      const customers = await prisma.customer.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          category: { select: { name: true } },
          priceList: { select: { name: true } },
          assignments: CURRENT_REP_INCLUDE,
        },
      });
      return customers.map(toRow);
    },
  );
}

function toRow(
  customer: Customer & {
    category: { name: string } | null;
    priceList: { name: string } | null;
    assignments: { rep: { id: string; code: string; name: string } }[];
  },
): CustomerRow {
  const current = customer.assignments[0]?.rep;
  return {
    id: customer.id,
    code: customer.code,
    name: customer.name,
    tradeName: customer.tradeName,
    phone: customer.phone,
    governorate: customer.governorate,
    city: customer.city,
    status: customer.status,
    paymentTerms: customer.paymentTerms,
    creditLimit: customer.creditLimit,
    creditDays: customer.creditDays,
    categoryName: customer.category?.name ?? null,
    priceListName: customer.priceList?.name ?? null,
    repId: current?.id ?? null,
    repName: current?.name ?? null,
    repCode: current?.code ?? null,
    createdAt: customer.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Single record
// ---------------------------------------------------------------------------

export interface CustomerDetail {
  customer: Customer;
  rep: { id: string; code: string; name: string; phone: string } | null;
  assignments: AssignmentRow[];
  ledger: LedgerRow[];
  balance: Decimal;
  availableCredit: Decimal;
}

/** One closed or open stretch of time under one rep. */
export interface AssignmentRow {
  id: string;
  repId: string;
  repName: string;
  repCode: string;
  fromDate: Date;
  toDate: Date | null;
}

export interface LedgerRow {
  id: string;
  entryType: string;
  debit: Decimal;
  credit: Decimal;
  balanceAfter: Decimal;
  notes: string | null;
  at: Date;
}

/**
 * The customer profile, with the current rep, the assignment history and the
 * ledger. `getCustomerScoped` answers `notFound()` for a record outside the
 * reader's scope, so a guessed id is indistinguishable from a missing one.
 */
export async function getCustomerDetail(actor: Actor, id: string): Promise<CustomerDetail> {
  const customer = await getCustomerScoped(actor, id);

  const assignments = await prisma.customerRepAssignment.findMany({
    where: { customerId: customer.id },
    orderBy: { fromDate: 'desc' },
    include: { rep: { select: { id: true, code: true, name: true, phone: true } } },
  });

  const ledger = await prisma.customerLedgerEntry.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: 'asc' },
  });

  const balance = ledgerBalance(ledger);

  return {
    customer,
    rep: assignments.find((row) => row.toDate === null)?.rep ?? null,
    assignments: assignments.map((row) => ({
      id: row.id,
      repId: row.rep.id,
      repName: row.rep.name,
      repCode: row.rep.code,
      fromDate: row.fromDate,
      toDate: row.toDate,
    })),
    ledger: ledger.map((row) => ({
      id: row.id,
      entryType: row.entryType,
      debit: row.debit,
      credit: row.credit,
      balanceAfter: row.balanceAfter,
      notes: row.notes,
      at: row.createdAt,
    })),
    balance,
    // Never negative: a customer over the limit has no room, not negative room.
    // The exposure rule that decides whether an order fits is Phase 5; this is
    // only what the profile can show today.
    availableCredit:
      customer.paymentTerms === 'CREDIT'
        ? Decimal.max(new Decimal(0), customer.creditLimit.minus(balance))
        : new Decimal(0),
  };
}

// ---------------------------------------------------------------------------
// Option lists for the forms
// ---------------------------------------------------------------------------

export interface Option {
  id: string;
  label: string;
}

export async function listCustomerCategories(): Promise<Option[]> {
  const rows = await prisma.customerCategory.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  return rows.map((row) => ({ id: row.id, label: row.name }));
}

export async function listPriceListOptions(): Promise<Option[]> {
  const rows = await prisma.priceList.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  return rows.map((row) => ({ id: row.id, label: row.name }));
}

/** Active reps, for the "assign or reassign" picker. */
export async function listRepOptions(): Promise<Option[]> {
  const rows = await prisma.rep.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, code: true },
  });
  return rows.map((row) => ({ id: row.id, label: `${row.code} — ${row.name}` }));
}

/** Counts for the dashboard tiles on the customers screen. */
export async function customerCounts(
  actor: Actor,
): Promise<{ total: number; active: number; blocked: number }> {
  const where = customerScope(actor);
  const [total, active, blocked] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.count({ where: { AND: [where, { status: 'ACTIVE' }] } }),
    prisma.customer.count({ where: { AND: [where, { status: 'BLOCKED' }] } }),
  ]);
  return { total, active, blocked };
}
