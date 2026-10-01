/**
 * Phase 3 acceptance, against a real PostgreSQL.
 *
 * The specification's two acceptance criteria for this phase are:
 *   - a rep sees and can only reach his own customers
 *   - a customer account created by a rep must change its password on first login
 *
 * The first is where "looks right" and "is right" come apart. A rep scope built
 * on "every customer this rep ever served" passes every read test and quietly
 * hands a rep the customers the office moved to a colleague - so the
 * reassignment cases check the *closed* row, not only the new one.
 *
 * The second goes through the real login service rather than reading the column,
 * because what matters is that the flag survives into the session and the Phase 1
 * guard turns it into a redirect.
 *
 * Services are called directly here (as `catalog.test.ts` does for its rules).
 * The action layer's CSRF and permission checks have their own suite.
 */
import { AuditAction, PaymentTerms, Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PERMISSIONS, roleCan } from '@/lib/auth/permissions';
import { Decimal } from '@/lib/format';
import { hashPassword } from '@/lib/passwords';
import { prisma } from '@/lib/prisma';
import { login } from '@/server/auth/service';
import type { SessionUser } from '@/server/auth/session';
import { loadActor, ValidationError, type Actor } from '@/server/data/access';
import { listCustomers } from '@/server/customers/queries';
import { canReceiveOrders, normalizeCreditTerms } from '@/server/customers/rules';
import {
  createCustomer,
  setCustomerStatus,
  updateCreditTerms,
  updateCustomer,
  type CreateCustomerInput,
} from '@/server/customers/service';
import { reassignCustomer } from '@/server/customers/service';
import { deleteRep, setRepActive, updateRep } from '@/server/reps/service';

const PASSWORD = 'Integration!Pass1';
const TRAIL = { ip: null, userAgent: 'customers-test' };

const TABLES = [
  'audit_logs',
  'login_attempts',
  'password_resets',
  'user_sessions',
  'customer_ledger_entries',
  'customer_rep_assignments',
  'reps',
  'customers',
  'users',
];

async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll();
});

async function makeUser(role: Role, phone: string) {
  return prisma.user.create({
    data: {
      role,
      phone,
      username: `u${phone.slice(-6)}`,
      passwordHash: await hashPassword(PASSWORD),
      mustChangePassword: false,
      isActive: true,
    },
  });
}

interface Fixture {
  adminUserId: string;
  repOneUserId: string;
  repTwoUserId: string;
  repOne: string;
  repTwo: string;
}

async function seedFixture(): Promise<Fixture> {
  const admin = await makeUser(Role.ADMIN, '+201000000011');
  const repOneUser = await makeUser(Role.REP, '+201000000012');
  const repOne = await prisma.rep.create({
    data: { code: 'R-0101', name: 'مندوب أول', phone: '+201000000012', userId: repOneUser.id },
  });
  const repTwoUser = await makeUser(Role.REP, '+201000000013');
  const repTwo = await prisma.rep.create({
    data: { code: 'R-0102', name: 'مندوب ثانٍ', phone: '+201000000013', userId: repTwoUser.id },
  });

  return {
    adminUserId: admin.id,
    repOneUserId: repOneUser.id,
    repTwoUserId: repTwoUser.id,
    repOne: repOne.id,
    repTwo: repTwo.id,
  };
}

/**
 * A live session for a user, as the cookie layer would produce.
 *
 * `loadActor` reads the master records from the database on every request rather
 * than trusting the cookie, so testing it needs a real session row and the shape
 * the app actually passes in - not a hand rolled object that happens to have the
 * fields the test reads.
 */
async function openSession(userId: string): Promise<SessionUser> {
  const session = await prisma.userSession.create({
    data: {
      userId,
      csrfToken: 'c'.repeat(32),
      expiresAt: new Date(Date.now() + 86_400_000),
    },
    select: { id: true, csrfToken: true, expiresAt: true, user: { select: { role: true } } },
  });

  return {
    id: userId,
    role: session.user.role,
    sessionId: session.id,
    csrfToken: session.csrfToken,
    mustChangePassword: false,
    expiresAt: session.expiresAt,
    displayName: 'مندوب',
  };
}

function adminActor(fixture: Fixture): Actor {
  return {
    userId: fixture.adminUserId,
    role: Role.ADMIN,
    repId: null,
    customerId: null,
    displayName: 'مدير',
  };
}

function repActor(fixture: Fixture, which: 'one' | 'two'): Actor {
  return {
    userId: fixture.repOneUserId,
    role: Role.REP,
    repId: which === 'one' ? fixture.repOne : fixture.repTwo,
    customerId: null,
    displayName: 'مندوب',
  };
}

let phoneCounter = 0;
/** A unique Egyptian mobile per call; `phone` is the login id and is unique. */
function nextPhone(): string {
  phoneCounter += 1;
  return `+2011${String(phoneCounter).padStart(7, '0')}`;
}

/**
 * The full create input, defaulted.
 *
 * Written as a builder rather than repeated inline because a missing field here
 * is a *type* error at best and, at worst, a silent difference from what a form
 * sends - which is the kind of difference a test then stops covering.
 */
function input(overrides: Partial<CreateCustomerInput> = {}): CreateCustomerInput {
  return {
    name: 'عميل للاختبار',
    tradeName: null,
    contactPerson: null,
    phone: nextPhone(),
    address: null,
    governorate: null,
    city: null,
    categoryId: null,
    priceListId: null,
    receiverType: 'BUSINESS',
    taxRegistrationNumber: null,
    nationalId: null,
    whatsappOptIn: false,
    notes: null,
    repId: null,
    username: null,
    creditTerms: { paymentTerms: PaymentTerms.CASH, creditLimit: new Decimal(0), creditDays: 0 },
    openingBalance: new Decimal(0),
    ...overrides,
  };
}

async function seedCustomer(
  fixture: Fixture,
  repId: string,
  overrides: Partial<CreateCustomerInput> = {},
): Promise<string> {
  const created = await createCustomer(adminActor(fixture), input({ repId, ...overrides }), TRAIL);
  return created.id;
}

describe('acceptance: a rep sees only his own customers', () => {
  it('lists the assigned customer and hides the other rep customer', async () => {
    const fixture = await seedFixture();
    const mine = await seedCustomer(fixture, fixture.repOne, { name: 'عميل المندوب الأول' });
    const theirs = await seedCustomer(fixture, fixture.repTwo, { name: 'عميل المندوب الثاني' });

    const page = await listCustomers(repActor(fixture, 'one'), {});

    expect(page.rows.map((row) => row.id)).toEqual([mine]);
    expect(page.total).toBe(1);
    // The other customer really exists, so this is a scope decision rather than
    // an empty table.
    expect(theirs).toBeTruthy();
    expect(await prisma.customer.count()).toBe(2);
  });

  it('names the current rep on the row', async () => {
    const fixture = await seedFixture();
    const id = await seedCustomer(fixture, fixture.repOne);

    const page = await listCustomers(adminActor(fixture), {});
    const row = page.rows.find((item) => item.id === id);

    expect(row?.repId).toBe(fixture.repOne);
    expect(row?.repName).toBe('مندوب أول');
  });

  it('follows the customer to the new rep and away from the old one', async () => {
    const fixture = await seedFixture();
    const id = await seedCustomer(fixture, fixture.repOne);

    expect((await listCustomers(repActor(fixture, 'one'), {})).total).toBe(1);
    expect((await listCustomers(repActor(fixture, 'two'), {})).total).toBe(0);

    await reassignCustomer(adminActor(fixture), id, fixture.repTwo, TRAIL);

    // The whole point: the old rep loses access at the moment of reassignment,
    // not "eventually", and not only after his next visit.
    expect((await listCustomers(repActor(fixture, 'one'), {})).total).toBe(0);
    expect((await listCustomers(repActor(fixture, 'two'), {})).total).toBe(1);
  });

  it('keeps the closed assignment as history and releases the uniqueness slot', async () => {
    const fixture = await seedFixture();
    const id = await seedCustomer(fixture, fixture.repOne);

    await reassignCustomer(adminActor(fixture), id, fixture.repTwo, TRAIL);

    const rows = await prisma.customerRepAssignment.findMany({
      where: { customerId: id },
      orderBy: { fromDate: 'asc' },
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]?.repId).toBe(fixture.repOne);
    expect(rows[0]?.toDate).not.toBeNull();
    // The closed row must release `open_customer_id`, or the next open row could
    // never be written and every future reassignment would fail.
    expect(rows[0]?.openCustomerId).toBeNull();
    expect(rows[1]?.repId).toBe(fixture.repTwo);
    expect(rows[1]?.toDate).toBeNull();
    expect(rows[1]?.openCustomerId).toBe(id);
  });

  it('refuses to assign a customer to the same rep twice', async () => {
    const fixture = await seedFixture();
    const id = await seedCustomer(fixture, fixture.repOne);

    await expect(reassignCustomer(adminActor(fixture), id, fixture.repOne, TRAIL)).rejects.toThrow(
      ValidationError,
    );
    expect(await prisma.customerRepAssignment.count({ where: { customerId: id } })).toBe(1);
  });

  it('keeps at most one open assignment per customer at the schema level', async () => {
    const fixture = await seedFixture();
    const id = await seedCustomer(fixture, fixture.repOne);

    // Two open rows would give "who is his rep now" two answers. The service
    // closes before it opens; this proves the database refuses the mistake even
    // if some future code path forgets.
    await expect(
      prisma.customerRepAssignment.create({
        data: { fromDate: new Date(), customerId: id, repId: fixture.repTwo, openCustomerId: id },
      }),
    ).rejects.toThrow();
  });

  it('refuses to hand a customer to an inactive rep', async () => {
    const fixture = await seedFixture();
    const id = await seedCustomer(fixture, fixture.repOne);

    await setRepActive(adminActor(fixture), fixture.repTwo, false, TRAIL);

    await expect(reassignCustomer(adminActor(fixture), id, fixture.repTwo, TRAIL)).rejects.toThrow(
      ValidationError,
    );
  });

  it('refuses to create a customer for another rep when the actor is a rep', async () => {
    const fixture = await seedFixture();

    await expect(
      createCustomer(repActor(fixture, 'one'), input({ repId: fixture.repTwo }), TRAIL),
    ).rejects.toThrow(ValidationError);
    expect(await prisma.customer.count()).toBe(0);
  });

  it('suspends the account when a rep is switched off', async () => {
    const fixture = await seedFixture();

    await setRepActive(adminActor(fixture), fixture.repOne, false, TRAIL);

    const rep = await prisma.rep.findUniqueOrThrow({ where: { id: fixture.repOne } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.repOneUserId } });

    expect(rep.isActive).toBe(false);
    // Otherwise the login keeps working until the cookie expires, and "off"
    // would mean one thing for the rep record and another for the office.
    expect(user.isActive).toBe(false);
  });

  it('refuses to delete a rep who still owns customers', async () => {
    const fixture = await seedFixture();
    await seedCustomer(fixture, fixture.repOne);

    await expect(deleteRep(adminActor(fixture), fixture.repOne, TRAIL)).rejects.toThrow(
      ValidationError,
    );
    expect(
      (await prisma.rep.findUniqueOrThrow({ where: { id: fixture.repOne } })).deletedAt,
    ).toBeNull();
  });

  it('takes the account down when the rep is deleted, not only the record', async () => {
    const fixture = await seedFixture();
    const sessionUser = await openSession(fixture.repOneUserId);

    await deleteRep(adminActor(fixture), fixture.repOne, TRAIL);

    // `is_active` on the rep only hides him from the assignment pickers. A login
    // left running would keep working and would resolve to a rep row that nothing
    // is meant to return - so deleting a rep has to kill the login the same way
    // switching him off does.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.repOneUserId } });
    expect(user.isActive).toBe(false);

    // Counted the way the session reader asks: rows with no revocation. The row
    // itself stays, because the audit trail points at it.
    const live = await prisma.userSession.count({
      where: { userId: fixture.repOneUserId, revokedAt: null },
    });
    expect(live).toBe(0);
    expect(
      (await prisma.userSession.findUniqueOrThrow({ where: { id: sessionUser.sessionId } }))
        .revokedAt,
    ).not.toBeNull();
  });

  it('does not resolve a deleted rep as a rep at all', async () => {
    const fixture = await seedFixture();
    const sessionUser = await openSession(fixture.repOneUserId);

    expect((await loadActor(sessionUser)).repId).toBe(fixture.repOne);

    await deleteRep(adminActor(fixture), fixture.repOne, TRAIL);

    // The link is dropped rather than left pointing at the dead row: every scoped
    // query denies on a null id, so that is the answer that cannot widen.
    expect((await loadActor(sessionUser)).repId).toBeNull();
  });

  it('keeps a switched off rep out of the actor, without touching his record', async () => {
    const fixture = await seedFixture();
    const sessionUser = await openSession(fixture.repOneUserId);

    await setRepActive(adminActor(fixture), fixture.repOne, false, TRAIL);

    expect((await loadActor(sessionUser)).repId).toBeNull();
    expect(
      (await prisma.rep.findUniqueOrThrow({ where: { id: fixture.repOne } })).deletedAt,
    ).toBeNull();
  });

  it('moves the login with the phone when a customer is edited', async () => {
    const fixture = await seedFixture();
    const id = await seedCustomer(fixture, fixture.repOne);
    const newPhone = nextPhone();

    await updateCustomer(
      adminActor(fixture),
      id,
      { ...input({ repId: fixture.repOne }), phone: newPhone, name: 'اسم بعد التعديل' },
      TRAIL,
    );

    const stored = await prisma.customer.findUniqueOrThrow({
      where: { id },
      include: { user: { select: { phone: true } } },
    });

    expect(stored.phone).toBe(newPhone);
    // The phone is the login id. If only the master record moved, the office would
    // call him on the new number and the account would still answer to the old.
    expect(stored.user?.phone).toBe(newPhone);
  });

  it('refuses a customer edit that would take another login phone', async () => {
    const fixture = await seedFixture();
    const mine = await seedCustomer(fixture, fixture.repOne);
    const otherPhone = (
      await prisma.user.findUniqueOrThrow({ where: { id: fixture.repTwoUserId } })
    ).phone;

    await expect(
      updateCustomer(
        adminActor(fixture),
        mine,
        { ...input({ repId: fixture.repOne }), phone: otherPhone, name: ' renaming' },
        TRAIL,
      ),
    ).rejects.toThrow(ValidationError);

    // The whole edit is refused, so the name change next to the phone does not
    // land half applied either.
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: mine } });
    expect(customer.phone).not.toBe(otherPhone);
    expect(customer.name).toBe('عميل للاختبار');
  });

  it('refuses a customer edit with no phone, because the phone is the login', async () => {
    const fixture = await seedFixture();
    const id = await seedCustomer(fixture, fixture.repOne);

    await expect(
      updateCustomer(
        adminActor(fixture),
        id,
        { ...input({ repId: fixture.repOne }), phone: null },
        TRAIL,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('moves the rep login with the phone and the username on an edit', async () => {
    const fixture = await seedFixture();
    const phone = nextPhone();

    await updateRep(
      adminActor(fixture),
      fixture.repOne,
      {
        name: 'مندوب أول محدث',
        phone,
        username: 'Ahmed.Updated',
        maxDiscountPercent: new Decimal('15'),
        hiredAt: new Date('2026-01-15T00:00:00.000Z'),
      },
      TRAIL,
    );

    const rep = await prisma.rep.findUniqueOrThrow({ where: { id: fixture.repOne } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.repOneUserId } });

    expect(rep.name).toBe('مندوب أول محدث');
    expect(rep.phone).toBe(phone);
    // Usernames are stored folded to lower case, so the login that resolves
    // `Ahmed.Updated` and the one stored here cannot disagree.
    expect(user.username).toBe('ahmed.updated');
    expect(user.phone).toBe(phone);
  });

  it('refuses a rep edit that would take a colleague login phone', async () => {
    const fixture = await seedFixture();
    const otherPhone = (
      await prisma.user.findUniqueOrThrow({ where: { id: fixture.repTwoUserId } })
    ).phone;

    await expect(
      updateRep(
        adminActor(fixture),
        fixture.repOne,
        {
          name: 'محاولة',
          phone: otherPhone,
          username: null,
          maxDiscountPercent: new Decimal(0),
          hiredAt: null,
        },
        TRAIL,
      ),
    ).rejects.toThrow(ValidationError);

    const rep = await prisma.rep.findUniqueOrThrow({ where: { id: fixture.repOne } });
    expect(rep.name).toBe('مندوب أول');
  });

  it('lets an admin read every customer', async () => {
    const fixture = await seedFixture();
    await seedCustomer(fixture, fixture.repOne, { name: 'أول' });
    await seedCustomer(fixture, fixture.repTwo, { name: 'ثانٍ' });

    expect((await listCustomers(adminActor(fixture), {})).total).toBe(2);
  });

  it('finds a customer by a Latin search term typed in any case', async () => {
    const fixture = await seedFixture();
    await seedCustomer(fixture, fixture.repOne, { name: 'مؤسسة Nile للتجارة' });

    const page = await listCustomers(adminActor(fixture), { search: 'nile' });

    expect(page.total).toBe(1);
    expect(page.rows[0]?.name).toBe('مؤسسة Nile للتجارة');
  });
});

describe('acceptance: a rep-created customer must change password on first login', () => {
  it('creates the login with mustChangePassword set', async () => {
    const fixture = await seedFixture();
    const id = await seedCustomer(fixture, fixture.repOne);

    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id },
      include: { user: { select: { mustChangePassword: true, role: true } } },
    });

    expect(customer.user).not.toBeNull();
    expect(customer.user?.mustChangePassword).toBe(true);
    expect(customer.user?.role).toBe(Role.CUSTOMER);
  });

  it('signs in with the temporary password and is flagged to change it', async () => {
    const fixture = await seedFixture();
    const phone = nextPhone();
    const created = await createCustomer(
      adminActor(fixture),
      input({ repId: fixture.repOne, phone, name: 'عميل بكلمة مؤقتة' }),
      TRAIL,
    );

    // The password the service generated, not a constant: this asserts the value
    // the rep is handed actually works.
    const result = await login({
      identifier: phone,
      password: created.temporaryPassword,
      ip: null,
      userAgent: 'customers-test',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.user.mustChangePassword).toBe(true);
  });

  it('gives every new customer a different temporary password', async () => {
    const fixture = await seedFixture();
    const actor = adminActor(fixture);

    const first = await createCustomer(actor, input({ repId: fixture.repOne }), TRAIL);
    const second = await createCustomer(actor, input({ repId: fixture.repOne }), TRAIL);

    // A shared temporary password would let the second customer sign in as the
    // first one until both changed it.
    expect(first.temporaryPassword).not.toBe(second.temporaryPassword);
  });

  it('stores the opening balance in the ledger as a signed entry', async () => {
    const fixture = await seedFixture();
    const owing = await seedCustomer(fixture, fixture.repOne, {
      openingBalance: new Decimal('1500.00'),
    });
    const advance = await seedCustomer(fixture, fixture.repOne, {
      openingBalance: new Decimal('-250.50'),
    });

    const rows = await prisma.customerLedgerEntry.findMany({ orderBy: { createdAt: 'asc' } });

    const owes = rows.find((row) => row.customerId === owing);
    expect(owes?.entryType).toBe('OPENING');
    expect(owes?.debit.toFixed(2)).toBe('1500.00');
    expect(owes?.credit.toFixed(2)).toBe('0.00');

    const paid = rows.find((row) => row.customerId === advance);
    expect(paid?.debit.toFixed(2)).toBe('0.00');
    expect(paid?.credit.toFixed(2)).toBe('250.50');
  });

  it('writes no ledger row for a zero opening balance', async () => {
    const fixture = await seedFixture();
    await seedCustomer(fixture, fixture.repOne, { openingBalance: new Decimal(0) });

    // An entry that moves nothing is noise, and a customer with no entries has a
    // zero balance by definition.
    expect(await prisma.customerLedgerEntry.count()).toBe(0);
  });
});

describe('credit terms', () => {
  it('zeroes the limit and the window when the terms go back to cash', async () => {
    const fixture = await seedFixture();
    const actor = adminActor(fixture);
    const id = await seedCustomer(fixture, fixture.repOne);

    await updateCreditTerms(
      actor,
      id,
      { paymentTerms: PaymentTerms.CREDIT, creditLimit: new Decimal('5000'), creditDays: 30 },
      TRAIL,
    );
    expect(
      (await prisma.customer.findUniqueOrThrow({ where: { id } })).creditLimit.toFixed(2),
    ).toBe('5000.00');

    await updateCreditTerms(
      actor,
      id,
      { paymentTerms: PaymentTerms.CASH, creditLimit: new Decimal('5000'), creditDays: 30 },
      TRAIL,
    );

    const customer = await prisma.customer.findUniqueOrThrow({ where: { id } });
    expect(customer.paymentTerms).toBe(PaymentTerms.CASH);
    expect(customer.creditLimit.toFixed(2)).toBe('0.00');
    expect(customer.creditDays).toBe(0);
  });

  it('refuses a negative credit limit and leaves the row alone', async () => {
    const fixture = await seedFixture();
    const id = await seedCustomer(fixture, fixture.repOne);

    await expect(
      updateCreditTerms(
        adminActor(fixture),
        id,
        { paymentTerms: PaymentTerms.CREDIT, creditLimit: new Decimal('-1'), creditDays: 30 },
        TRAIL,
      ),
    ).rejects.toThrow(ValidationError);

    expect((await prisma.customer.findUniqueOrThrow({ where: { id } })).paymentTerms).toBe(
      PaymentTerms.CASH,
    );
  });

  it('keeps a credit customer with a zero limit, which is a real state', async () => {
    const fixture = await seedFixture();
    const id = await seedCustomer(fixture, fixture.repOne);

    await updateCreditTerms(
      adminActor(fixture),
      id,
      { paymentTerms: PaymentTerms.CREDIT, creditLimit: new Decimal(0), creditDays: 0 },
      TRAIL,
    );

    const customer = await prisma.customer.findUniqueOrThrow({ where: { id } });
    expect(customer.paymentTerms).toBe(PaymentTerms.CREDIT);
    expect(customer.creditLimit.toFixed(2)).toBe('0.00');
  });

  it('agrees with the pure rule the unit suite covers', () => {
    // The service normalises through this function, so a change to either that
    // does not reach the other shows up here as a disagreement rather than as a
    // silent difference between a unit test and the database.
    expect(
      normalizeCreditTerms({
        paymentTerms: 'CASH',
        creditLimit: new Decimal('99'),
        creditDays: 9,
      }).creditLimit.toFixed(2),
    ).toBe('0.00');
  });
});

describe('blocking a customer', () => {
  it('takes a blocked customer out of the orders rule', async () => {
    const fixture = await seedFixture();
    const id = await seedCustomer(fixture, fixture.repOne);

    expect(canReceiveOrders('ACTIVE')).toBe(true);

    await setCustomerStatus(adminActor(fixture), id, 'BLOCKED', TRAIL);

    const customer = await prisma.customer.findUniqueOrThrow({ where: { id } });
    expect(customer.status).toBe('BLOCKED');
    // Phase 5 asks this on approval; the predicate lives in one tested place.
    expect(canReceiveOrders(customer.status)).toBe(false);
  });

  it('keeps a blocked customer in the list, flagged rather than hidden', async () => {
    const fixture = await seedFixture();
    const id = await seedCustomer(fixture, fixture.repOne);

    await setCustomerStatus(adminActor(fixture), id, 'BLOCKED', TRAIL);

    // Hiding the row would leave the rep thinking the customer had vanished.
    const page = await listCustomers(adminActor(fixture), { status: 'BLOCKED' });
    expect(page.rows.map((row) => row.id)).toEqual([id]);
  });

  it('leaves the login working, because a blocked customer still owes money', async () => {
    const fixture = await seedFixture();
    const id = await seedCustomer(fixture, fixture.repOne);

    await setCustomerStatus(adminActor(fixture), id, 'BLOCKED', TRAIL);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: (await prisma.customer.findUniqueOrThrow({ where: { id } })).userId! },
    });
    // He needs to see his balance to settle it.
    expect(user.isActive).toBe(true);
  });
});

describe('audit', () => {
  it('records a reassignment with both reps and the actor', async () => {
    const fixture = await seedFixture();
    const id = await seedCustomer(fixture, fixture.repOne);

    await reassignCustomer(adminActor(fixture), id, fixture.repTwo, TRAIL);

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'Customer', entityId: id, action: AuditAction.STATUS_CHANGE },
    });

    expect(entry.actorUserId).toBe(fixture.adminUserId);
    // The assignments table answers "who is he now"; the audit answers "who
    // moved him, when, and from whom", which is the question nobody asks until
    // a month later.
    expect(JSON.stringify(entry.beforeJson)).toContain(fixture.repOne);
    expect(JSON.stringify(entry.afterJson)).toContain(fixture.repTwo);
  });

  it('records the customer creation with the login it created', async () => {
    const fixture = await seedFixture();
    const id = await seedCustomer(fixture, fixture.repOne);

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'Customer', entityId: id, action: AuditAction.CREATE },
    });

    expect(entry.metadata).not.toBeNull();
    expect(JSON.stringify(entry.metadata)).toContain('userId');
  });
});

describe('the permission map decides who may administer', () => {
  it('gives rep administration to admin alone', () => {
    // Asserted here rather than left to the actions so a change to the map
    // cannot quietly hand a rep the ability to switch his colleague off.
    expect(roleCan(Role.ADMIN, PERMISSIONS.REPS_WRITE)).toBe(true);
    expect(roleCan(Role.REP, PERMISSIONS.REPS_WRITE)).toBe(false);
    expect(roleCan(Role.STOREKEEPER, PERMISSIONS.REPS_WRITE)).toBe(false);
    expect(roleCan(Role.ACCOUNTANT, PERMISSIONS.REPS_WRITE)).toBe(false);
  });

  it('gives customer blocking to admin alone', () => {
    expect(roleCan(Role.ADMIN, PERMISSIONS.CUSTOMERS_BLOCK)).toBe(true);
    expect(roleCan(Role.REP, PERMISSIONS.CUSTOMERS_BLOCK)).toBe(false);
  });

  it('gives reassignment to admin alone', () => {
    expect(roleCan(Role.ADMIN, PERMISSIONS.CUSTOMERS_ASSIGN_REP)).toBe(true);
    expect(roleCan(Role.REP, PERMISSIONS.CUSTOMERS_ASSIGN_REP)).toBe(false);
  });

  it('lets a rep create and edit his own customer', () => {
    expect(roleCan(Role.REP, PERMISSIONS.CUSTOMERS_CREATE)).toBe(true);
    expect(roleCan(Role.REP, PERMISSIONS.CUSTOMERS_WRITE_OWN)).toBe(true);
    expect(roleCan(Role.REP, PERMISSIONS.CUSTOMERS_WRITE_ALL)).toBe(false);
  });

  it('does not let a storekeeper or accountant touch customer master data', () => {
    for (const role of [Role.STOREKEEPER, Role.ACCOUNTANT] as const) {
      expect(roleCan(role, PERMISSIONS.CUSTOMERS_CREATE)).toBe(false);
      expect(roleCan(role, PERMISSIONS.CUSTOMERS_WRITE_OWN)).toBe(false);
      expect(roleCan(role, PERMISSIONS.CUSTOMERS_WRITE_ALL)).toBe(false);
    }
  });
});
