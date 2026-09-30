/**
 * Authentication service (Phase 1).
 *
 * Everything that changes authentication state runs through here so the
 * ordering of the checks is in exactly one place:
 *
 *   1. rate limit / lockout  (per account and per IP)
 *   2. account lookup        (phone or username)
 *   3. account state         (active, not deleted, not locked)
 *   4. password verification
 *   5. audit + session issue
 *
 * The order matters: a locked account must not be distinguishable from a
 * wrong password, and the verification runs even for unknown accounts so the
 * response time does not reveal whether the account exists.
 */
import { AuditAction, Role, type User } from '@prisma/client';

import { getEnv } from '@/config/env';
import { logger } from '@/lib/logger';
import { hashPassword, verifyPassword } from '@/lib/passwords';
import { prisma, withTransaction, type Tx } from '@/lib/prisma';
import { CSRF_COOKIE, CSRF_FIELD, CSRF_HEADER, SESSION_COOKIE } from '@/lib/auth/cookies';
import { normalizeLoginIdentifier } from '@/lib/auth/identifiers';
import {
  evaluateLockout,
  lockDuration,
  shouldCountFailure,
  windowStart,
  type LockoutReason,
} from '@/lib/auth/lockout';
import { writeAudit, type AuditContext } from '@/server/audit/service';

export { CSRF_COOKIE, CSRF_FIELD, CSRF_HEADER, SESSION_COOKIE };

export interface LoginInput {
  identifier: string;
  password: string;
  ip: string | null;
  userAgent: string | null;
}

export type LoginResult =
  | { status: 'ok'; user: PublicUser; session: IssuedSession }
  | { status: 'invalid_credentials'; retryAfterSeconds: number | null }
  | { status: 'locked'; retryAfterSeconds: number }
  | { status: 'rate_limited'; reason: LockoutReason; retryAfterSeconds: number | null }
  | { status: 'inactive' };

/** The user shape that leaves the server: never carries the hash. */
export interface PublicUser {
  id: string;
  role: Role;
  username: string | null;
  phone: string;
  name: string | null;
  mustChangePassword: boolean;
}

export function toPublicUser(user: User, name: string | null): PublicUser {
  return {
    id: user.id,
    role: user.role,
    username: user.username,
    phone: user.phone,
    name,
    mustChangePassword: user.mustChangePassword,
  };
}

/**
 * A dummy hash is verified against when the account does not exist, so that a
 * missing account and a wrong password take the same time.
 */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('not-a-real-password');
  return dummyHashPromise;
}

export async function login(input: LoginInput): Promise<LoginResult> {
  const env = getEnv();
  const now = new Date();
  const identifier = normalizeLoginIdentifier(input.identifier);
  const isPhone = identifier.startsWith('+');
  const since = windowStart(now, env.LOGIN_WINDOW_MINUTES);

  const user = await prisma.user.findFirst({
    where: isPhone ? { phone: identifier } : { username: identifier },
  });

  const countFails = shouldCountFailure({
    accountExists: Boolean(user),
    identifierIsUsername: !isPhone,
  });

  const [accountFailures, ipFailures] = await Promise.all([
    prisma.loginAttempt.count({
      where: { identifier, successful: false, at: { gte: since } },
    }),
    input.ip
      ? prisma.loginAttempt.count({
          where: { ip: input.ip, successful: false, at: { gte: since } },
        })
      : Promise.resolve(0),
  ]);

  const decision = evaluateLockout({
    accountFailures,
    ipFailures,
    lockedUntil: user?.lockedUntil ?? null,
    now,
  });

  if (!decision.allowed) {
    await recordAttempt({ identifier, userId: user?.id ?? null, ip: input.ip, successful: false });
    if (user && decision.locksAccount) {
      await lockUser(user.id, lockDuration(now), {
        role: user.role,
        context: input,
        metadata: { identifier },
      });
    }
    await auditAuth(
      decision.reason === 'ACCOUNT_LOCKED' ? AuditAction.ACCOUNT_LOCKED : AuditAction.LOGIN_FAILED,
      user?.id ?? null,
      user?.role ?? null,
      { identifier, reason: decision.reason, ip: input.ip, userAgent: input.userAgent },
    );
    return {
      status: decision.reason === 'ACCOUNT_LOCKED' ? 'locked' : 'rate_limited',
      retryAfterSeconds: decision.retryAfterSeconds ?? 60,
    } as LoginResult;
  }

  if (!user) {
    if (countFails) {
      await recordAttempt({ identifier, userId: null, ip: input.ip, successful: false });
    }
    await verifyPassword(await dummyHash(), input.password);
    await auditAuth(AuditAction.LOGIN_FAILED, null, null, {
      identifier,
      reason: 'unknown_account',
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { status: 'invalid_credentials', retryAfterSeconds: null };
  }

  if (user.deletedAt || !user.isActive) {
    await verifyPassword(await dummyHash(), input.password);
    await auditAuth(AuditAction.LOGIN_FAILED, user.id, user.role, {
      identifier,
      reason: 'inactive_account',
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { status: 'inactive' };
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) {
    await recordAttempt({ identifier, userId: user.id, ip: input.ip, successful: false });
    // The counter on the user row is the human readable one ("this account has
    // N bad attempts"); the rows in `login_attempts` are the windowed truth the
    // limits are evaluated against. Both move on every failure.
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
    });
    if (decision.locksAccount) {
      // `lockUser` writes the lock and its single ACCOUNT_LOCKED audit row, so
      // the log records one lock rather than one per call site that trips it.
      await lockUser(user.id, lockDuration(now), {
        role: user.role,
        context: input,
        metadata: { identifier },
      });
    }
    await auditAuth(AuditAction.LOGIN_FAILED, user.id, user.role, {
      identifier,
      reason: 'bad_password',
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return decision.locksAccount
      ? { status: 'locked', retryAfterSeconds: env.LOGIN_LOCKOUT_MINUTES * 60 }
      : { status: 'invalid_credentials', retryAfterSeconds: null };
  }

  const name = await displayName(user.id, user.role);
  const session = await withTransaction(async (tx) => {
    // Reset the counter only on success, and only after the password check.
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    await tx.loginAttempt.create({
      data: { identifier, userId: user.id, ip: input.ip, successful: true },
    });
    const session = await createSession(tx, {
      userId: user.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    await writeAudit(tx, {
      action: AuditAction.LOGIN,
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      actorRole: user.role,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { sessionId: session.id },
    });
    return session;
  });

  logger.info({ userId: user.id, role: user.role, ip: input.ip }, 'login succeeded');
  return { status: 'ok', user: toPublicUser(user, name), session };
}

export interface IssuedSession {
  id: string;
  csrfToken: string;
  expiresAt: Date;
}

export async function createSession(
  tx: Tx,
  input: { userId: string; ip: string | null; userAgent: string | null },
): Promise<IssuedSession> {
  const env = getEnv();
  const csrfToken = randomToken();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000);
  const session = await tx.userSession.create({
    data: {
      userId: input.userId,
      csrfToken,
      ip: input.ip,
      userAgent: input.userAgent,
      expiresAt,
    },
  });
  return { id: session.id, csrfToken, expiresAt };
}

export function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Buffer.from(buffer).toString('base64url');
}

async function lockUser(
  userId: string,
  until: Date,
  input: { role: Role; context: AuditContext; metadata: Record<string, unknown> },
): Promise<void> {
  // The failure counter was already incremented by the caller, so this only has
  // to write the lock itself.
  await prisma.user.update({
    where: { id: userId },
    data: { lockedUntil: until },
  });
  await auditAuth(
    AuditAction.ACCOUNT_LOCKED,
    userId,
    input.role,
    { ...input.metadata, lockedUntil: until.toISOString() },
    input.context,
  );
}

async function recordAttempt(input: {
  identifier: string;
  userId: string | null;
  ip: string | null;
  successful: boolean;
}): Promise<void> {
  await prisma.loginAttempt.create({
    data: {
      identifier: input.identifier,
      userId: input.userId,
      ip: input.ip,
      successful: input.successful,
    },
  });
}

async function auditAuth(
  action: AuditAction,
  actorUserId: string | null,
  actorRole: Role | null,
  metadata: Record<string, unknown>,
  context: AuditContext = {},
): Promise<void> {
  await writeAudit(prisma, {
    action,
    entityType: 'User',
    entityId: actorUserId ?? 'anonymous',
    actorUserId,
    actorRole,
    metadata,
    ip: context.ip ?? null,
    userAgent: context.userAgent ?? null,
  });
}

async function displayName(userId: string, role: Role): Promise<string | null> {
  if (role === Role.REP) {
    const rep = await prisma.rep.findUnique({ where: { userId }, select: { name: true } });
    return rep?.name ?? null;
  }
  if (role === Role.CUSTOMER) {
    const customer = await prisma.customer.findUnique({
      where: { userId },
      select: { name: true },
    });
    return customer?.name ?? null;
  }
  return userId;
}
