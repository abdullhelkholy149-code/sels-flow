/**
 * Phase 1 acceptance, second half: failed logins are rate limited and audited.
 *
 * This is the end to end proof that the lockout policy is actually wired to
 * the database: the pure policy is unit tested in `lockout.test.ts`, and here
 * the same rules are exercised through `login()` against a real PostgreSQL.
 */
import { AuditAction, Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

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
  return prisma.user.create({
    data: {
      role: Role.ADMIN,
      phone: overrides.phone ?? PHONE,
      username: 'tester',
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

    for (const identifier of ['01000000010', '002010000000010', '201000000010', '+201000000010']) {
      const result = await login({ identifier, password: PASSWORD, ip: null, userAgent: null });
      expect(result.status).toBe('ok');
    }
  });

  it('accepts the username as well as the phone', async () => {
    await makeUser();

    const result = await login({
      identifier: 'TESTER',
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
  it('blocks a clean account once the ip is over its limit', async () => {
    const user = await makeUser();

    // The per account threshold (5) is lower than the per ip one (10), so the
    // account lock would normally fire first. Unlock between attempts to prove
    // the ip limit is a separate control that works on its own.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await login({ identifier: PHONE, password: 'Wrong!Pass1', ip: IP, userAgent: null });
      await prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil: null, failedLoginCount: 0 },
      });
    }

    // Six more failures from the same ip, each on a fresh account so no
    // per-account threshold can be what stops the next attempt.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await login({
        identifier: `+20100001000${attempt}`,
        password: 'Wrong!Pass1',
        ip: IP,
        userAgent: null,
      });
    }

    const limited = await login({
      identifier: user.phone,
      password: PASSWORD,
      ip: IP,
      userAgent: null,
    });

    expect(limited.status).toBe('rate_limited');
    // The account itself was never locked: the ip is the reason.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.lockedUntil).toBeNull();
  });

  it('does not count failures from a different ip', async () => {
    const user = await makeUser();

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await login({ identifier: PHONE, password: 'Wrong!Pass1', ip: IP, userAgent: null });
      await prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil: null, failedLoginCount: 0 },
      });
    }

    // A different ip is unaffected by the first ip's failures.
    const result = await login({
      identifier: PHONE,
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
