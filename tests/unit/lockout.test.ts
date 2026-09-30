/**
 * Lockout policy (Section 4: rate limit per IP and per account, lockout after
 * repeated failures).
 *
 * The functions under test are pure, so every branch is reachable without a
 * database or a clock that has to be waited on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test?schema=public';
process.env.AUTH_SECRET ??= 'test-secret-that-is-at-least-32-characters-long';
process.env.SIGNED_LINK_SECRET ??= 'test-secret-that-is-at-least-32-characters-long';

const { evaluateLockout, lockDuration, shouldCountFailure, windowStart } = await import(
  '@/lib/auth/lockout'
);
const { resetEnvForTests } = await import('@/config/env');

const NOW = new Date('2026-03-01T10:00:00.000Z');

beforeEach(() => {
  resetEnvForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('evaluateLockout', () => {
  it('allows the first attempts through', () => {
    const decision = evaluateLockout({
      accountFailures: 0,
      ipFailures: 0,
      lockedUntil: null,
      now: NOW,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBeNull();
  });

  it('blocks an account that is already locked and reports the wait', () => {
    const lockedUntil = new Date(NOW.getTime() + 10 * 60_000);
    const decision = evaluateLockout({
      accountFailures: 0,
      ipFailures: 0,
      lockedUntil,
      now: NOW,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('ACCOUNT_LOCKED');
    expect(decision.retryAfterSeconds).toBe(600);
  });

  it('lets a login through once the lock has expired', () => {
    const lockedUntil = new Date(NOW.getTime() - 1000);
    const decision = evaluateLockout({
      accountFailures: 0,
      ipFailures: 0,
      lockedUntil,
      now: NOW,
    });

    expect(decision.allowed).toBe(true);
  });

  it('locks the account on the attempt that reaches the threshold', () => {
    // Default LOGIN_MAX_ATTEMPTS_PER_ACCOUNT is 5, so the 5th failure trips it.
    const fourth = evaluateLockout({
      accountFailures: 3,
      ipFailures: 0,
      lockedUntil: null,
      now: NOW,
    });
    expect(fourth.allowed).toBe(true);
    expect(fourth.locksAccount).toBe(false);

    const fifth = evaluateLockout({
      accountFailures: 4,
      ipFailures: 0,
      lockedUntil: null,
      now: NOW,
    });
    expect(fifth.allowed).toBe(true);
    expect(fifth.locksAccount).toBe(true);
  });

  it('blocks once the account is over the threshold', () => {
    const decision = evaluateLockout({
      accountFailures: 5,
      ipFailures: 0,
      lockedUntil: null,
      now: NOW,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('RATE_LIMITED_ACCOUNT');
  });

  it('blocks an ip that is over the per ip limit, even for a clean account', () => {
    const decision = evaluateLockout({
      accountFailures: 0,
      ipFailures: 10,
      lockedUntil: null,
      now: NOW,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('RATE_LIMITED_IP');
  });

  it('reports the account lock before the ip limit', () => {
    const decision = evaluateLockout({
      accountFailures: 99,
      ipFailures: 99,
      lockedUntil: new Date(NOW.getTime() + 60_000),
      now: NOW,
    });

    expect(decision.reason).toBe('ACCOUNT_LOCKED');
  });

  it('never returns a negative retry', () => {
    const decision = evaluateLockout({
      accountFailures: 0,
      ipFailures: 0,
      lockedUntil: new Date(NOW.getTime() - 5_000),
      now: NOW,
    });

    if (decision.retryAfterSeconds !== null) {
      expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    }
  });
});

describe('lockDuration', () => {
  it('is LOGIN_LOCKOUT_MINUTES in the future', () => {
    expect(lockDuration(NOW).getTime()).toBe(NOW.getTime() + 15 * 60_000);
  });
});

describe('windowStart', () => {
  it('moves the cutoff back by the window length', () => {
    expect(windowStart(NOW, 15).getTime()).toBe(NOW.getTime() - 15 * 60_000);
  });
});

describe('shouldCountFailure', () => {
  it('always counts a failure against a real account', () => {
    expect(shouldCountFailure({ accountExists: true, identifierIsUsername: false })).toBe(true);
    expect(shouldCountFailure({ accountExists: true, identifierIsUsername: true })).toBe(true);
  });

  it('counts an unknown phone against the ip limit', () => {
    // Otherwise an attacker enumerates accounts from a single ip for free.
    expect(shouldCountFailure({ accountExists: false, identifierIsUsername: false })).toBe(true);
  });

  it('does not count an unknown username', () => {
    expect(shouldCountFailure({ accountExists: false, identifierIsUsername: true })).toBe(false);
  });
});
