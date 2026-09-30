/**
 * Session lifecycle and CSRF (Phase 1).
 *
 * The cookie holds an opaque session id only. Everything that makes the id
 * trustworthy - not expired, not revoked, user still active - is checked in the
 * database on every request, so a suspended account loses access immediately
 * instead of at cookie expiry (decision D-010).
 */
import { AuditAction, Role } from '@prisma/client';
import { cookies } from 'next/headers';

import { getEnv } from '@/config/env';
import { CSRF_COOKIE, CSRF_FIELD, SESSION_COOKIE } from '@/lib/auth/cookies';
import { prisma, type Tx } from '@/lib/prisma';
import { writeAudit } from '@/server/audit/service';
import { randomToken, type IssuedSession } from '@/server/auth/service';

export { CSRF_COOKIE, CSRF_FIELD, SESSION_COOKIE };

export interface SessionUser {
  id: string;
  role: Role;
  sessionId: string;
  csrfToken: string;
  mustChangePassword: boolean;
  expiresAt: Date;
  /** Rep or customer display name, read from the master record. */
  displayName: string;
}

function baseCookieOptions() {
  const env = getEnv();
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

/** Writes the session cookie and the readable CSRF cookie. */
export async function setSessionCookies(session: IssuedSession): Promise<void> {
  const env = getEnv();
  const store = await cookies();

  store.set(SESSION_COOKIE, session.id, {
    ...baseCookieOptions(),
    expires: session.expiresAt,
  });
  // Readable by the client on purpose: it is the double submit half of the
  // CSRF token, and the value is worthless without the httpOnly session.
  store.set(CSRF_COOKIE, session.csrfToken, {
    httpOnly: false,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: session.expiresAt,
  });
}

export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(CSRF_COOKIE);
}

export async function getSessionId(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Resolves the signed in user, or null. Touches `lastSeenAt` at most once a
 * minute so a busy screen does not write on every request.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const sessionId = await getSessionId();
  if (!sessionId) return null;

  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    include: {
      user: {
        select: {
          id: true,
          role: true,
          mustChangePassword: true,
          isActive: true,
          deletedAt: true,
          username: true,
          phone: true,
          rep: { select: { name: true } },
          customer: { select: { name: true } },
        },
      },
    },
  });

  const now = new Date();
  if (!session || session.revokedAt || session.expiresAt <= now) return null;
  if (!session.user.isActive || session.user.deletedAt) return null;

  if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.userSession
      .update({ where: { id: session.id }, data: { lastSeenAt: now } })
      .catch(() => undefined);
  }

  return {
    id: session.user.id,
    role: session.user.role,
    sessionId: session.id,
    csrfToken: session.csrfToken,
    mustChangePassword: session.user.mustChangePassword,
    expiresAt: session.expiresAt,
    // The rep or customer master record holds the name; an admin falls back to
    // the username, then the phone number.
    displayName:
      session.user.rep?.name ??
      session.user.customer?.name ??
      session.user.username ??
      session.user.phone,
  };
}

/**
 * The CSRF cookie for the anonymous screens is seeded by the middleware: Next
 * only allows a cookie to be written in a Server Action or a Route Handler, so
 * a helper that a page render could call would throw at runtime rather than
 * fail at build. Nothing else may set cookies during a render.
 */

function setCsrfCookie(store: Awaited<ReturnType<typeof cookies>>, value: string): void {
  const env = getEnv();
  store.set(CSRF_COOKIE, value, {
    // Readable by the client on purpose: it is the double submit half of the
    // CSRF token, and the value is worthless without the httpOnly session.
    httpOnly: false,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(env.CSRF_TTL_MINUTES * 60),
  });
}

/** Replaces the readable CSRF cookie, e.g. after the session token is rotated. */
export async function setCsrfCookieValue(value: string): Promise<void> {
  setCsrfCookie(await cookies(), value);
}

export class CsrfError extends Error {
  constructor(message = 'invalid csrf token') {
    super(message);
    this.name = 'CsrfError';
  }
}

/**
 * The security decision itself, kept pure so every branch is testable without a
 * request context.
 *
 * The trusted value is the session row, not the cookie: a forged cookie cannot
 * help, because the submitted field is compared against the token stored with
 * the session. A missing expected value always fails, so a cookie that was
 * cleared never turns into a bypass.
 */
export function verifyCsrfField(
  submitted: FormDataEntryValue | null,
  expected: string | null | undefined,
): void {
  if (typeof submitted !== 'string' || submitted.length < 20) {
    throw new CsrfError('missing csrf token');
  }
  if (!expected || !tokensMatch(submitted, expected)) {
    throw new CsrfError('csrf token mismatch');
  }
}

/**
 * Verifies the double submit token of a mutating form.
 *
 * `session` is null on the anonymous screens, where the cookie is the only
 * reference there is.
 */
export async function assertFormCsrf(
  formData: FormData,
  session: SessionUser | null,
): Promise<void> {
  const expected = session ? session.csrfToken : (await cookies()).get(CSRF_COOKIE)?.value;

  verifyCsrfField(formData.get(CSRF_FIELD), expected);
}

export async function revokeSession(sessionId: string, tx?: Tx): Promise<void> {
  const db = tx ?? prisma;
  await db.userSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Admin suspension: kill every live session of the account immediately. */
export async function revokeAllSessions(userId: string, tx: Tx): Promise<number> {
  const result = await tx.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function logout(
  sessionId: string,
  context: { ip: string | null; userAgent: string | null },
): Promise<void> {
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    select: { userId: true, user: { select: { role: true } } },
  });
  await revokeSession(sessionId);
  if (session) {
    await writeAudit(prisma, {
      action: AuditAction.LOGOUT,
      entityType: 'User',
      entityId: session.userId,
      actorUserId: session.userId,
      actorRole: session.user.role,
      ip: context.ip,
      userAgent: context.userAgent,
    });
  }
}

/** Constant time comparison, so a token guess cannot be timed. */
export function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Issues a fresh CSRF token; used after a password change. */
export async function rotateCsrfToken(tx: Tx, sessionId: string): Promise<string> {
  const token = randomToken();
  await tx.userSession.update({ where: { id: sessionId }, data: { csrfToken: token } });
  return token;
}
