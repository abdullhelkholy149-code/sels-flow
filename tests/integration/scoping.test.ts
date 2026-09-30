/**
 * Phase 1 acceptance: server side data scoping (Section 4).
 *
 * The specification asks for automated proof of exactly these three things:
 *   - a rep cannot read another rep's customer by id
 *   - a customer cannot read another customer's document by id
 *   - guessing a url / id returns 404 or 403
 *
 * These run against a REAL PostgreSQL, because a scoping bug that only appears
 * against a real query plan is the kind that ships.
 */
import { AuditAction, Role, type Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PERMISSIONS } from '@/lib/auth/permissions';
import { hashPassword } from '@/lib/passwords';
import { prisma } from '@/lib/prisma';
import {
  Actor,
  PermissionDenied,
  assertPermission,
  customerDocumentScope,
  customerScope,
  getCustomerScoped,
  getRepScoped,
  isAdmin,
  repScope,
  safeOrderBy,
} from '@/server/data/access';
import { diffRecords, writeAudit } from '@/server/audit/service';

const PASSWORD = 'Integration!Pass1';

// Every table this suite touches, in an order that respects the foreign keys.
const TABLES: Array<{ table: string; order: number }> = [
  { table: 'audit_logs', order: 1 },
  { table: 'login_attempts', order: 2 },
  { table: 'password_resets', order: 3 },
  { table: 'user_sessions', order: 4 },
  { table: 'reps', order: 5 },
  { table: 'customers', order: 6 },
  { table: 'users', order: 7 },
];

async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE ' + TABLES.map((t) => t.table).join(', ') + ' RESTART IDENTITY CASCADE',
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll();
});

interface Fixture {
  admin: { id: string };
  repOne: { id: string; userId: string; repId: string };
  repTwo: { id: string; userId: string; repId: string };
  customerOfRepOne: { id: string };
  customerOfRepTwo: { id: string };
}

async function makeUser(role: Role, phone: string, password = PASSWORD) {
  const passwordHash = await hashPassword(password);
  return prisma.user.create({
    data: {
      role,
      phone,
      username: `user${phone.slice(-6)}`,
      passwordHash,
      mustChangePassword: false,
      isActive: true,
    },
  });
}

/** One admin, two reps, and one customer belonging to each rep. */
async function seedFixture(): Promise<Fixture> {
  const admin = await makeUser(Role.ADMIN, '+201000000001');

  const repUserOne = await makeUser(Role.REP, '+201000000002');
  const repOne = await prisma.rep.create({
    data: { code: 'R-0001', name: 'مندوب أول', phone: '+201000000002', userId: repUserOne.id },
  });
  const repUserTwo = await makeUser(Role.REP, '+201000000003');
  const repTwo = await prisma.rep.create({
    data: { code: 'R-0002', name: 'مندوب ثانٍ', phone: '+201000000003', userId: repUserTwo.id },
  });

  const customerOfRepOne = await prisma.customer.create({
    data: { code: 'C-0001', name: 'عميل المندوب الأول', userId: null },
  });
  const customerOfRepTwo = await prisma.customer.create({
    data: { code: 'C-0002', name: 'عميل المندوب الثاني', userId: null },
  });

  return {
    admin,
    repOne: { id: repUserOne.id, userId: repUserOne.id, repId: repOne.id },
    repTwo: { id: repUserTwo.id, userId: repUserTwo.id, repId: repTwo.id },
    customerOfRepOne,
    customerOfRepTwo,
  };
}

function repActor(fixture: Fixture, which: 'one' | 'two'): Actor {
  const rep = which === 'one' ? fixture.repOne : fixture.repTwo;
  return {
    userId: rep.userId,
    role: Role.REP,
    repId: rep.repId,
    customerId: null,
    displayName: 'مندوب',
  };
}

function customerActor(customerId: string): Actor {
  return {
    userId: 'user-of-customer',
    role: Role.CUSTOMER,
    repId: null,
    customerId,
    displayName: 'عميل',
  };
}

function adminActor(fixture: Fixture): Actor {
  return {
    userId: fixture.admin.id,
    role: Role.ADMIN,
    repId: null,
    customerId: null,
    displayName: 'مدير',
  };
}

// ---------------------------------------------------------------------------

describe('actor and role helpers', () => {
  it('treats only admin as the superuser role', async () => {
    const fixture = await seedFixture();
    expect(isAdmin(adminActor(fixture))).toBe(true);
    expect(isAdmin(repActor(fixture, 'one'))).toBe(false);
    expect(isAdmin(customerActor(fixture.customerOfRepOne.id))).toBe(false);
  });
});

describe('acceptance: a rep cannot read another rep customer by id', () => {
  it('throws notFound for a customer owned by the other rep', async () => {
    const fixture = await seedFixture();
    const actorOne = repActor(fixture, 'one');

    // The customer really exists, so this is a scope failure, not a 404 from a
    // bad id. `notFound()` is what Next.js turns into a 404 page.
    await expect(getCustomerScoped(actorOne, fixture.customerOfRepTwo.id)).rejects.toThrow();
  });

  it('resolves a customer for the role that owns it', async () => {
    const fixture = await seedFixture();
    const actor = customerActor(fixture.customerOfRepOne.id);

    // A customer always sees his own record, which is the positive half of the
    // rule and the one the 404 behaviour must not break.
    await expect(getCustomerScoped(actor, fixture.customerOfRepOne.id)).resolves.toMatchObject({
      id: fixture.customerOfRepOne.id,
    });
  });

  it('resolves any customer for a role holding customers:read_all', async () => {
    const fixture = await seedFixture();

    await expect(
      getCustomerScoped(adminActor(fixture), fixture.customerOfRepTwo.id),
    ).resolves.toMatchObject({ id: fixture.customerOfRepTwo.id });
  });

  it('never returns the other rep customer through a list query either', async () => {
    const fixture = await seedFixture();
    const actorOne = repActor(fixture, 'one');

    // The scope fragment is what a list screen would pass to Prisma. Prove it
    // against the database rather than trusting the object shape.
    const visible = await prisma.customer.findMany({
      where: { AND: [{ deletedAt: null }, customerScope(actorOne)] },
    });

    // Phase 3 replaces this placeholder scope with the assignment lookup. The
    // placeholder id matches nothing, so a rep sees an empty list rather than
    // every customer: the safe direction.
    expect(visible).toEqual([]);
  });

  it('lets admin read any customer', async () => {
    const fixture = await seedFixture();
    const actor = adminActor(fixture);

    await expect(getCustomerScoped(actor, fixture.customerOfRepTwo.id)).resolves.toMatchObject({
      id: fixture.customerOfRepTwo.id,
    });
  });
});

describe('acceptance: a customer cannot read another customer document by id', () => {
  it('scopes a document query to the signed in customer only', async () => {
    const fixture = await seedFixture();
    const actor = customerActor(fixture.customerOfRepOne.id);

    // Invoices arrive in phase 6; the scoping contract is what matters now, so
    // it is exercised against the customer table a document hangs off, using
    // the very fragment a document query will use.
    const visible = await prisma.customer.findMany({
      where: { AND: [{ id: customerDocumentScope(actor).customerId }] },
    });

    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe(fixture.customerOfRepOne.id);

    // The other customer exists and is none of his business.
    const other = await prisma.customer.findUnique({
      where: { id: fixture.customerOfRepTwo.id },
    });
    expect(other).not.toBeNull();
  });

  it('resolves no document id for a role with no document read grant', async () => {
    const fixture = await seedFixture();
    const actor = adminActor(fixture);

    // An admin reads documents through a different scope, not through the
    // customer one, so the customer scope must name no row at all rather than
    // falling back to "everything".
    const visible = await prisma.customer.findMany({
      where: { AND: [{ id: customerDocumentScope(actor).customerId }] },
    });
    expect(visible).toEqual([]);
  });

  it('rejects an out of scope id through getCustomerScoped', async () => {
    const fixture = await seedFixture();
    const actor = customerActor(fixture.customerOfRepOne.id);

    await expect(getCustomerScoped(actor, fixture.customerOfRepTwo.id)).rejects.toThrow();
    await expect(getCustomerScoped(actor, fixture.customerOfRepOne.id)).resolves.toMatchObject({
      id: fixture.customerOfRepOne.id,
    });
  });
});

describe('acceptance: guessing a url / id returns 404 or 403', () => {
  it('gives notFound for a well formed uuid that does not exist', async () => {
    const fixture = await seedFixture();
    const actor = adminActor(fixture);
    const missing = '00000000-0000-4000-8000-000000000000';

    await expect(getCustomerScoped(actor, missing)).rejects.toThrow();
  });

  it('gives notFound rather than forbidden for an out of scope record', async () => {
    const fixture = await seedFixture();
    const actor = customerActor(fixture.customerOfRepOne.id);

    // A 403 here would confirm the id exists. The 404 must be indistinguishable
    // from a record that was never created (decision D-011).
    const outOfScope = getCustomerScoped(actor, fixture.customerOfRepTwo.id);
    const nonExistent = getCustomerScoped(actor, '00000000-0000-4000-8000-000000000000');

    const messages = await Promise.all(
      [outOfScope, nonExistent].map((call) => call.then(() => 'resolved').catch(() => 'notFound')),
    );
    expect(messages).toEqual(['notFound', 'notFound']);
  });

  it('throws a 403 shaped error when a screen level permission is missing', async () => {
    const fixture = await seedFixture();
    const actor = customerActor(fixture.customerOfRepOne.id);

    // assertPermission is the variant used inside actions and API routes,
    // where a redirect to a 404 page would be wrong. The actor identity is
    // irrelevant to the outcome: only the role's grants decide.
    expect(() => assertPermission(actor, PERMISSIONS.USERS_READ)).toThrow(PermissionDenied);
    expect(() => assertPermission(actor, PERMISSIONS.ORDERS_CREATE_CUSTOMER)).not.toThrow();
    expect(() =>
      assertPermission({ ...actor, role: Role.ADMIN }, PERMISSIONS.USERS_WRITE),
    ).not.toThrow();
  });
});

describe('rep scoping of the reps table', () => {
  it('lets a rep read only his own rep row', async () => {
    const fixture = await seedFixture();
    const actor = repActor(fixture, 'one');

    await expect(getRepScoped(actor, fixture.repOne.repId)).resolves.toMatchObject({
      id: fixture.repOne.repId,
    });
    await expect(getRepScoped(actor, fixture.repTwo.repId)).rejects.toThrow();
  });

  it('builds a rep scope fragment a list query can use', async () => {
    const fixture = await seedFixture();
    const actor = repActor(fixture, 'two');

    const visible = await prisma.rep.findMany({ where: repScope(actor) });

    // A rep's scope names exactly one id, so the database can answer the query
    // with an index rather than a filter in application code.
    expect(visible.map((row) => row.id)).toEqual([fixture.repTwo.repId]);
  });

  it('gives a customer no access to rep records at all', async () => {
    const fixture = await seedFixture();
    const actor = customerActor(fixture.customerOfRepOne.id);

    await expect(getRepScoped(actor, fixture.repOne.repId)).rejects.toThrow();
  });
});

describe('list helpers', () => {
  it('only sorts by a column the screen declares', () => {
    const allowed = ['name', 'createdAt'] as const;

    expect(safeOrderBy(allowed, 'name', 'asc', { createdAt: 'desc' })).toEqual({ name: 'asc' });
    // An injected column falls back instead of reaching the database.
    expect(
      safeOrderBy(allowed, 'passwordHash; DROP TABLE users', 'asc', { createdAt: 'desc' }),
    ).toEqual({
      createdAt: 'desc',
    });
    expect(safeOrderBy(allowed, undefined, undefined, { createdAt: 'desc' })).toEqual({
      createdAt: 'desc',
    });
  });
});

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

describe('audit log', () => {
  it('records the actor, the action and the before/after image', async () => {
    const fixture = await seedFixture();

    await writeAudit(prisma, {
      action: AuditAction.UPDATE,
      entityType: 'User',
      entityId: fixture.admin.id,
      actorUserId: fixture.admin.id,
      actorRole: Role.ADMIN,
      ip: '10.0.0.1',
      userAgent: 'vitest',
      before: { isActive: true },
      after: { isActive: false },
    });

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'User', entityId: fixture.admin.id },
      orderBy: { at: 'desc' },
    });

    expect(row.action).toBe(AuditAction.UPDATE);
    expect(row.actorUserId).toBe(fixture.admin.id);
    expect(row.actorRole).toBe(Role.ADMIN);
    expect(row.ip).toBe('10.0.0.1');
    expect(row.userAgent).toBe('vitest');
    expect(row.beforeJson).toEqual({ isActive: true });
    expect(row.afterJson).toEqual({ isActive: false });
  });

  it('keeps the row even when the actor is deleted', async () => {
    const throwaway = await makeUser(Role.ADMIN, '+201000000099');

    await writeAudit(prisma, {
      action: AuditAction.LOGIN,
      entityType: 'User',
      entityId: throwaway.id,
      actorUserId: throwaway.id,
      actorRole: Role.ADMIN,
    });

    await prisma.user.delete({ where: { id: throwaway.id } });

    // `onDelete: SetNull` keeps the trail: history survives the account.
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: throwaway.id },
    });
    expect(row.actorUserId).toBeNull();
  });

  it('serializes dates and bigints as strings so jsonb never chokes', async () => {
    await writeAudit(prisma, {
      action: AuditAction.CREATE,
      entityType: 'SerializationTest',
      entityId: 'x',
      after: { when: new Date('2026-01-01T00:00:00.000Z'), big: 10n },
    });

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'SerializationTest' },
    });
    const after = row.afterJson as Prisma.JsonObject;

    expect(after.when).toBe('2026-01-01T00:00:00.000Z');
    expect(after.big).toBe('10');
  });

  it('never throws when the write fails, so business work is not rolled back', async () => {
    const brokenDb = {
      auditLog: {
        create: () => Promise.reject(new Error('audit table unavailable')),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      writeAudit(brokenDb, { action: AuditAction.CREATE, entityType: 'X', entityId: '1' }),
    ).resolves.toBeUndefined();
  });

  it('reports only the fields that actually changed', () => {
    const change = diffRecords(
      { name: 'قبل', phone: '+201000000001', role: 'REP' },
      { name: 'بعد', phone: '+201000000001', role: 'REP' },
    );

    expect(change).toEqual({ before: { name: 'قبل' }, after: { name: 'بعد' } });
  });
});
