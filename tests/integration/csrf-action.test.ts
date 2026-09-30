/**
 * CSRF through a real mutating request (Phase 1).
 *
 * `csrf.test.ts` proves the comparison function. That was never enough: the
 * defect that made `/ar/login` return 500 lived in code no unit test touched,
 * because the check and the thing it protects are wired together by the request,
 * not by an import. So this drives the server actions themselves, against a
 * real PostgreSQL, and asserts that a rejected request changed nothing.
 *
 * The only thing faked here is the request scope that Next provides around a
 * Server Action: `cookies()` and `headers()`. That is the boundary a real POST
 * crosses, so the action's own code runs unchanged. The cookie jar is reset
 * between tests so one test's token cannot satisfy the next.
 */
import { Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieJar = new Map<string, string>();
const headerJar = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
  headers: async () => ({
    get: (name: string) => headerJar.get(name),
  }),
}));

// The action asks Next to drop a cached page. There is no cache in a test.
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

// Imported after the mocks on purpose: these are the modules under test, and
// the mocks above are hoisted above them by the transform.
const { loginAction } = await import('@/server/auth/actions');
const { login } = await import('@/server/auth/service');
const { CSRF_COOKIE, CSRF_FIELD, SESSION_COOKIE } = await import('@/server/auth/session');
const { updateCompanySettingsAction } = await import('@/server/settings/actions');
const { getCompanySettings } = await import('@/server/settings/service');
const { hashPassword } = await import('@/lib/passwords');
const { prisma } = await import('@/lib/prisma');

const PASSWORD = 'Correct!Horse9';
const PHONE = '+201000000030';
const ANON_TOKEN = 'a'.repeat(43);
const OTHER_SESSION_TOKEN = 'b'.repeat(43);

async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE audit_logs, login_attempts, password_resets, user_sessions, reps, customers, users RESTART IDENTITY CASCADE',
  );
  await prisma.companySettings.deleteMany();
  cookieJar.clear();
  headerJar.clear();
  headerJar.set('user-agent', 'csrf-action-test');
}

/** Every field the strict settings schema wants, so a rejection is only ever about CSRF. */
const SETTINGS = {
  legalName: 'شركة سالز فلو للتوزيع',
  taxRegistrationNumber: '',
  branchCode: '',
  activityCode: '',
  address: 'القاهرة',
  phone: '+201000000001',
  email: '',
  defaultVatRate: '14',
  invoicePrefix: 'INV',
  creditNotePrefix: 'CN',
  orderPrefix: 'ORD',
  returnWindowDays: '7',
  blockOnOverdue: 'true',
  overdueGraceDays: '3',
  geofenceRadiusM: '200',
  geofenceBlock: 'false',
  defaultMaxDiscountPercent: '10',
  whatsappEnabled: 'false',
  defaultCreditDays: '30',
};

async function seedAdmin(): Promise<void> {
  await prisma.user.create({
    data: {
      role: Role.ADMIN,
      phone: PHONE,
      username: 'csrftester',
      passwordHash: await hashPassword(PASSWORD),
      mustChangePassword: false,
      isActive: true,
    },
  });
  await prisma.companySettings.upsert({
    where: { id: 1 },
    create: { id: 1, legalName: SETTINGS.legalName, defaultVatRate: 14 },
    // The truncate above spares company_settings, so without this the previous
    // test's value would still be sitting in the row and every "nothing was
    // written" assertion would be comparing against the wrong baseline.
    update: {
      legalName: SETTINGS.legalName,
      taxRegistrationNumber: null,
      branchCode: null,
      activityCode: null,
      address: SETTINGS.address,
      phone: SETTINGS.phone,
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

/** A signed in admin, with its session cookie in the jar. */
async function signIn(): Promise<string> {
  const result = await login({
    identifier: PHONE,
    password: PASSWORD,
    ip: null,
    userAgent: 'csrf-action-test',
  });
  if (result.status !== 'ok') throw new Error(`could not sign in: ${result.status}`);
  cookieJar.set(SESSION_COOKIE, result.session.id);
  cookieJar.set(CSRF_COOKIE, result.session.csrfToken);
  return result.session.csrfToken;
}

function settingsForm(token: string | null, overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries({ ...SETTINGS, ...overrides })) {
    formData.append(key, value);
  }
  if (token !== null) formData.append(CSRF_FIELD, token);
  return formData;
}

async function settingsAuditRows() {
  return prisma.auditLog.findMany({ where: { entityType: 'CompanySettings' } });
}

beforeEach(async () => {
  await truncateAll();
  await seedAdmin();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('a signed in mutation', () => {
  it("accepts the session's own token and writes the change with its audit row", async () => {
    const token = await signIn();

    const result = await updateCompanySettingsAction(
      null,
      settingsForm(token, { legalName: 'الاسم بعد التعديل' }),
    );

    expect(result.ok).toBe(true);
    expect((await getCompanySettings()).legalName).toBe('الاسم بعد التعديل');

    const rows = await settingsAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorRole).toBe(Role.ADMIN);
    expect(rows[0]?.beforeJson).toMatchObject({ legalName: SETTINGS.legalName });
    expect(rows[0]?.afterJson).toMatchObject({ legalName: 'الاسم بعد التعديل' });
  });

  it('rejects a request with no token field, and writes nothing', async () => {
    await signIn();

    const result = await updateCompanySettingsAction(
      null,
      settingsForm(null, { legalName: 'لم يُكتب' }),
    );

    expect(result.ok).toBe(false);
    // The message is for the reader of the form, not a stack trace.
    expect(result.message).toBe('انتهت صلاحية الجلسة، حدّث الصفحة وحاول مرة أخرى');
    expect((await getCompanySettings()).legalName).toBe(SETTINGS.legalName);
    expect(await settingsAuditRows()).toHaveLength(0);
  });

  it('rejects a guessed token, and writes nothing', async () => {
    await signIn();

    const result = await updateCompanySettingsAction(
      null,
      settingsForm(OTHER_SESSION_TOKEN, { legalName: 'لم يُكتب' }),
    );

    expect(result.ok).toBe(false);
    expect((await getCompanySettings()).legalName).toBe(SETTINGS.legalName);
    expect(await settingsAuditRows()).toHaveLength(0);
  });

  it('rejects a token too short to be one of ours', async () => {
    // The length floor is what stops an empty field from matching an empty
    // expected value in some future refactor.
    await signIn();

    const result = await updateCompanySettingsAction(
      null,
      // A name the schema would accept, so the only reason to reject is the token.
      settingsForm('short', { legalName: 'الاسم المزيف' }),
    );

    expect(result.ok).toBe(false);
    expect((await getCompanySettings()).legalName).toBe(SETTINGS.legalName);
  });

  it('rejects a token that belongs to another live session', async () => {
    // The session row is the reference, never the cookie. A token copied out of
    // a second account's readable cookie must not pass here.
    await signIn();
    cookieJar.set(CSRF_COOKIE, OTHER_SESSION_TOKEN);

    const result = await updateCompanySettingsAction(
      null,
      settingsForm(OTHER_SESSION_TOKEN, { legalName: 'لم يُكتب' }),
    );

    expect(result.ok).toBe(false);
    expect((await getCompanySettings()).legalName).toBe(SETTINGS.legalName);
    expect(await settingsAuditRows()).toHaveLength(0);
  });

  it('rejects the token of a session that was revoked', async () => {
    const token = await signIn();
    const sessionId = cookieJar.get(SESSION_COOKIE) as string;

    await prisma.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });

    const result = await updateCompanySettingsAction(
      null,
      settingsForm(token, { legalName: 'لم يُكتب' }),
    );

    expect(result.ok).toBe(false);
    expect((await getCompanySettings()).legalName).toBe(SETTINGS.legalName);
  });
});

describe('an anonymous mutation (the login form)', () => {
  it('rejects the field when the cookie is absent, which is what a cross site POST looks like', async () => {
    // SameSite=Lax is the reason the cookie is missing here: a form posted from
    // another origin does not carry it, so there is nothing for the field to
    // match and the request dies before credentials are read.
    const formData = new FormData();
    formData.append(CSRF_FIELD, ANON_TOKEN);
    formData.append('identifier', PHONE);
    formData.append('password', PASSWORD);

    const result = await loginAction(null, formData);

    expect(result.ok).toBe(false);
    expect(result.message).toBe('انتهت صلاحية الجلسة، حدّث الصفحة وحاول مرة أخرى');
    // The dangerous part is not the message, it is that no session exists.
    expect(await prisma.userSession.count()).toBe(0);
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });

  it('rejects the cookie value in the field when the field is the only half present', async () => {
    cookieJar.set(CSRF_COOKIE, ANON_TOKEN);

    const formData = new FormData();
    formData.append('identifier', PHONE);
    formData.append('password', PASSWORD);

    const result = await loginAction(null, formData);

    expect(result.ok).toBe(false);
    expect(await prisma.userSession.count()).toBe(0);
  });

  it('lets a real anonymous submission through, and binds the new cookie to the session', async () => {
    // The check must not be so strict that the login screen stops working: the
    // middleware seeded this cookie, and the submitted field repeats it.
    cookieJar.set(CSRF_COOKIE, ANON_TOKEN);

    const formData = new FormData();
    formData.append(CSRF_FIELD, ANON_TOKEN);
    formData.append('identifier', PHONE);
    formData.append('password', PASSWORD);

    const result = await loginAction(null, formData);

    expect(result.ok).toBe(true);
    expect(await prisma.userSession.count()).toBe(1);

    // The readable cookie is replaced by the session's own token, so the next
    // form in the browser matches without the middleware having to intervene.
    const sessionCookie = cookieJar.get(CSRF_COOKIE);
    expect(sessionCookie).not.toBe(ANON_TOKEN);
    const session = await prisma.userSession.findFirstOrThrow();
    expect(sessionCookie).toBe(session.csrfToken);
  });
});
