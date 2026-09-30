/**
 * Lockout policy (Section 4: rate limit per IP and per account, lockout after
 * repeated failures, admin can reset).
 *
 * Pure functions only. The caller supplies the counts, so the policy is unit
 * testable without a database and the queries stay in the data layer.
 */
import { getEnv } from '@/config/env';

export type LockoutReason = 'ACCOUNT_LOCKED' | 'RATE_LIMITED_ACCOUNT' | 'RATE_LIMITED_IP';

export interface AttemptWindow {
  /** Failed attempts for this account inside the window. */
  accountFailures: number;
  /** Failed attempts from this IP inside the window, any account. */
  ipFailures: number;
  /** Set when the account is already locked; the value is when it lifts. */
  lockedUntil: Date | null;
  /** Now, injected so tests are deterministic. */
  now: Date;
}

/**
 * A refusal always carries the reason it refused, so the union makes
 * `decision.reason` non-null on the refused branch. Typed as a plain interface
 * it was only `LockoutReason | null` there, which let a caller build a
 * `rate_limited` result without the reason and hide the gap behind a cast.
 */
export type LockoutDecision =
  | {
      allowed: true;
      reason: null;
      /** True when this failure is the one that trips the lock. */
      locksAccount: boolean;
      lockedUntil: Date | null;
      retryAfterSeconds: null;
    }
  | {
      allowed: false;
      reason: LockoutReason;
      locksAccount: false;
      lockedUntil: Date | null;
      retryAfterSeconds: number | null;
    };

export function windowStart(now: Date, minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000);
}

export function evaluateLockout(window: AttemptWindow): LockoutDecision {
  const env = getEnv();

  if (window.lockedUntil && window.lockedUntil > window.now) {
    return {
      allowed: false,
      reason: 'ACCOUNT_LOCKED',
      locksAccount: false,
      lockedUntil: window.lockedUntil,
      retryAfterSeconds: secondsUntil(window.lockedUntil, window.now),
    };
  }

  if (window.accountFailures >= env.LOGIN_MAX_ATTEMPTS_PER_ACCOUNT) {
    return {
      allowed: false,
      reason: 'RATE_LIMITED_ACCOUNT',
      locksAccount: false,
      lockedUntil: window.lockedUntil,
      retryAfterSeconds: secondsUntil(window.lockedUntil, window.now),
    };
  }

  if (window.ipFailures >= env.LOGIN_MAX_ATTEMPTS_PER_IP) {
    return {
      allowed: false,
      reason: 'RATE_LIMITED_IP',
      locksAccount: false,
      lockedUntil: window.lockedUntil,
      retryAfterSeconds: secondsUntil(window.lockedUntil, window.now),
    };
  }

  // The next failure is the one that reaches the account threshold.
  const locksAccount = window.accountFailures + 1 >= env.LOGIN_MAX_ATTEMPTS_PER_ACCOUNT;
  return {
    allowed: true,
    reason: null,
    locksAccount,
    lockedUntil: window.lockedUntil,
    retryAfterSeconds: null,
  };
}

/** How long to lock the account when this failure trips the threshold. */
export function lockDuration(now: Date): Date {
  const minutes = getEnv().LOGIN_LOCKOUT_MINUTES;
  return new Date(now.getTime() + minutes * 60_000);
}

/**
 * Whether a failed attempt should count towards the limits at all. Failures on
 * unknown accounts are the ones an attacker uses, so they must count, but they
 * can never lock a real account.
 */
export function shouldCountFailure(input: {
  accountExists: boolean;
  identifierIsUsername: boolean;
}): boolean {
  if (input.accountExists) return true;
  // An unknown phone still counts against the IP limit, but an unknown
  // username is rejected earlier for performance and does not count.
  return input.identifierIsUsername ? false : true;
}

function secondsUntil(target: Date | null, now: Date): number | null {
  if (!target) return null;
  return Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 1000));
}
