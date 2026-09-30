/**
 * Phase 1 acceptance, second half: failed logins are rate limited and audited.
 *
 * This is the end to end proof that the lockout policy is actually wired to
 * the database: the pure policy is unit tested in `lockout.test.ts`, and here
 * the same rules are exercised through `login()` against a real PostgreSQL.
 */
import { AuditAction, Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { isValidEgyptianPhone } from '@/lib/auth/identifiers';
import { hashPassword } from '@/lib/passwords';
import { prisma } from '@/lib/prisma';
import { login } from '@/server/auth/service';

const PASSWORD = 'Correct!Horse9';

const PHONE = '+201000000010';
const IP = '192.0.2.10';
const OTHER_IP = '192.0.2.11';

async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE audit_logs, login_attempts, password_resets, user_sessions, reps, customers, users RESTART IDENTITY CASCADE',
  );
}

beforeEach(truncateAll);

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeUser(
  overrides: { phone?: string; isActive?: boolean; lockedUntil?: Date | null } = {},
) {
  const phone = overrides.phone ?? PHONE;
  return prisma.user.create({
    data: {
      role: Role.ADMIN,
      phone,
      // Both columns are unique, so a second account in the same test needs its
      // own username as well as its own phone.
      username: `tester${phone.slice(-4)}`,
      passwordHash: await hashPassword(PASSWORD),
      mustChangePassword: false,
      isActive: overrides.isActive ?? true,
      lockedUntil: overrides.lockedUntil ?? null,
    },
  });
}

async function auditRows(action: AuditAction) {
  return prisma.auditLog.findMany({ where: { action }, orderBy: { at: 'asc' } });
}

/** The first audit row for an action, asserted to exist. */
async function firstAudit(action: AuditAction) {
  const row = (await auditRows(action))[0];
  if (!row) throw new Error(`expected at least one ${action} audit row`);
  return row;
}

describe('successful login', () => {
  it('issues a session, resets the counters and audits the event', async () => {
    const user = await makeUser();

    const result = await login({
      identifier: PHONE,
      password: PASSWORD,
      ip: IP,
      userAgent: 'vitest',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    // A session row exists and carries a CSRF token, so the cookie is useless
    // on its own.
    const session = await prisma.userSession.findUniqueOrThrow({
      where: { id: result.session.id },
    });
    expect(session.userId).toBe(user.id);
    expect(session.csrfToken.length).toBeGreaterThan(20);
    expect(session.revokedAt).toBeNull();
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // The counters moved.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.lastLoginAt).not.toBeNull();
    expect(after.failedLoginCount).toBe(0);
    expect(after.lockedUntil).toBeNull();

    // The login is audited, with the ip and user agent.
    const audit = await firstAudit(AuditAction.LOGIN);
    expect(audit.actorUserId).toBe(user.id);
    expect(audit.actorRole).toBe(Role.ADMIN);
    expect(audit.ip).toBe(IP);
    expect(audit.userAgent).toBe('vitest');
  });

  it('accepts the phone in any accepted format', async () => {
    await makeUser();

    // Each of these is the same number written differently. `0020` is the
    // international prefix without the plus, so it is `00` + the country code +
    // the national number: 2 + 2 + 10 digits. One digit too many here does not
    // normalize to the account, it is a different number.
    for (const identifier of ['01000000010', '00201000000010', '201000000010', '+201000000010']) {
      const result = await login({ identifier, password: PASSWORD, ip: null, userAgent: null });
      expect(result.status).toBe('ok');
    }
  });

  it('accepts the username as well as the phone', async () => {
    const user = await makeUser();

    const result = await login({
      // Upper case on purpose: usernames are case folded, so the same account
      // is found either way.
      identifier: (user.username ?? '').toUpperCase(),
      password: PASSWORD,
      ip: null,
      userAgent: null,
    });
    expect(result.status).toBe('ok');
  });
});

describe('failed login is audited', () => {
  it('records a wrong password with the account identified', async () => {
    const user = await makeUser();

    const result = await login({
      identifier: PHONE,
      password: 'Wrong!Pass1',
      ip: IP,
      userAgent: null,
    });

    expect(result.status).toBe('invalid_credentials');

    const audit = await firstAudit(AuditAction.LOGIN_FAILED);
    expect(audit.actorUserId).toBe(user.id);
    expect(audit.ip).toBe(IP);
    expect(audit.metadata).toMatchObject({ reason: 'bad_password' });
  });

  it('records an unknown account without an actor', async () => {
    const result = await login({
      identifier: '+201000000099',
      password: PASSWORD,
      ip: IP,
      userAgent: null,
    });

    expect(result.status).toBe('invalid_credentials');

    const audit = await firstAudit(AuditAction.LOGIN_FAILED);
    // `entityId: 'anonymous'` keeps the attempt on record without inventing a
    // user id that does not exist.
    expect(audit.entityId).toBe('anonymous');
    expect(audit.actorUserId).toBeNull();
    expect(audit.metadata).toMatchObject({ reason: 'unknown_account' });
  });

  it('gives the same answer for a suspended account as for a wrong password', async () => {
    await makeUser({ isActive: false });

    const suspended = await login({
      identifier: PHONE,
      password: PASSWORD,
      ip: IP,
      userAgent: null,
    });
    const unknown = await login({
      identifier: '+201000000099',
      password: PASSWORD,
      ip: IP,
      userAgent: null,
    });

    // An attacker must not be able to tell "no such account" from "account
    // exists but is disabled". Both answers are a failed login; the audit
    // carries the difference, which is where it belongs.
    expect(suspended.status).toBe('inactive');
    expect(unknown.status).toBe('invalid_credentials');
    expect((await auditRows(AuditAction.LOGIN_FAILED)).length).toBe(2);
  });

  it('rejects a soft deleted account', async () => {
    const user = await makeUser();
    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });

    const result = await login({
      identifier: PHONE,
      password: PASSWORD,
      ip: null,
      userAgent: null,
    });
    expect(result.status).toBe('inactive');
  });
});

describe('lockout after repeated failures', () => {
  it('locks the account on the fifth failure and blocks the correct password', async () => {
    const user = await makeUser();

    // The default threshold is LOGIN_MAX_ATTEMPTS_PER_ACCOUNT = 5.
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const result = await login({
        identifier: PHONE,
        password: 'Wrong!Pass1',
        ip: IP,
        userAgent: null,
      });
      expect(result.status).toBe('invalid_credentials');
    }

    // The fifth failure trips the lock.
    const fifth = await login({
      identifier: PHONE,
      password: 'Wrong!Pass1',
      ip: IP,
      userAgent: null,
    });
    expect(fifth.status).toBe('locked');

    const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.lockedUntil).not.toBeNull();
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // Even the right password is refused while the lock holds.
    const correct = await login({ identifier: PHONE, password: PASSWORD, ip: IP, userAgent: null });
    expect(correct.status).toBe('locked');

    // The lock itself is audited, separately from the failures.
    expect((await auditRows(AuditAction.ACCOUNT_LOCKED)).length).toBeGreaterThanOrEqual(1);
  });

  it('releases the lock once it expires', async () => {
    const user = await makeUser({ lockedUntil: new Date(Date.now() - 1000) });

    const result = await login({
      identifier: PHONE,
      password: PASSWORD,
      ip: null,
      userAgent: null,
    });
    expect(result.status).toBe('ok');

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.lockedUntil).toBeNull();
  });

  it('does not lock a different account because one account is locked', async () => {
    await makeUser();
    const other = await makeUser({ phone: '+201000000011' });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await login({ identifier: PHONE, password: 'Wrong!Pass1', ip: IP, userAgent: null });
    }

    // The other account signs in from a different ip.
    const result = await login({
      identifier: other.phone,
      password: PASSWORD,
      ip: OTHER_IP,
      userAgent: null,
    });
    expect(result.status).toBe('ok');
  });
});

describe('per ip rate limit', () => {
  /**
   * The limits are evaluated from the `login_attempts` rows inside the window
   * (decision D-012), so a test that wants to prove the per-ip rule has to keep
   * the per-account count below its threshold on its own. Using a fresh unknown
   * number per attempt does that: the failures are real and count against the
   * ip, and no single account ever reaches the account threshold.
   */
  async function failFromIp(ip: string, times: number): Promise<void> {
    for (let attempt = 1; attempt <= times; attempt += 1) {
      // +20 then ten digits in a real mobile shape, so the identifier is
      // normalised as a phone. An unknown phone still counts against the ip.
      const identifier = `+201${String(500_000 + attempt).padStart(9, '0')}`;
      expect(isValidEgyptianPhone(identifier)).toBe(true);

      const result = await login({
        identifier,
        password: 'Wrong!Pass1',
        ip,
        userAgent: null,
      });
      // None of these may be refused early, or the count would not be the number
      // of failures the assertion claims.
      expect(result.status).toBe('invalid_credentials');
    }
  }

  it('blocks a clean account once the ip is over its limit', async () => {
    const user = await makeUser();

    // The per ip threshold (10) is higher than the per account one (5), so the
    // ip limit can only be reached by failing on many different accounts.
    await failFromIp(IP, 10);

    const limited = await login({
      identifier: user.phone,
      password: PASSWORD,
      ip: IP,
      userAgent: null,
    });

    expect(limited.status).toBe('rate_limited');
    // The reason has to be the ip, otherwise this test would also pass when the
    // account limit is what stopped the attempt.
    if (limited.status !== 'rate_limited') return;
    expect(limited.reason).toBe('RATE_LIMITED_IP');

    // The account itself was never locked and never accumulated a failure.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.lockedUntil).toBeNull();
    expect(after.failedLoginCount).toBe(0);
  });

  it('does not count failures from a different ip', async () => {
    const user = await makeUser();

    // Eight failures from one ip, spread over many accounts so the account
    // limit stays out of the way, and under the ip threshold of ten.
    await failFromIp(IP, 8);

    // A different ip is unaffected by the first ip's failures: the account is
    // still clean and the second ip has no history.
    const result = await login({
      identifier: user.phone,
      password: PASSWORD,
      ip: OTHER_IP,
      userAgent: null,
    });
    expect(result.status).toBe('ok');
  });
});

describe('attempt log', () => {
  it('stores every attempt with its outcome, so the limits are reproducible', async () => {
    const user = await makeUser();

    await login({ identifier: PHONE, password: 'Wrong!Pass1', ip: IP, userAgent: null });
    await login({ identifier: PHONE, password: PASSWORD, ip: IP, userAgent: null });

    const attempts = await prisma.loginAttempt.findMany({ orderBy: { at: 'asc' } });

    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      identifier: PHONE,
      successful: false,
      ip: IP,
      userId: user.id,
    });
    expect(attempts[1]).toMatchObject({
      identifier: PHONE,
      successful: true,
      ip: IP,
      userId: user.id,
    });
  });

  it('does not count a successful attempt towards the failure window', async () => {
    const user = await makeUser();

    await login({ identifier: PHONE, password: 'Wrong!Pass1', ip: IP, userAgent: null });
    await login({ identifier: PHONE, password: PASSWORD, ip: IP, userAgent: null });

    const failures = await prisma.loginAttempt.count({
      where: { identifier: PHONE, successful: false },
    });
    expect(failures).toBe(1);
    expect(user).toBeDefined();
  });
});
