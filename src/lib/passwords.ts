/**
 * Password hashing. Argon2id only (Section 2), with parameters taken from the
 * environment so they can be tuned without touching code.
 */
import { argon2id, hash as argon2Hash, verify as argon2Verify, type Options } from 'argon2';

import { getEnv } from '@/config/env';

function options(): Options & { type: typeof argon2id } {
  const env = getEnv();
  return {
    type: argon2id,
    memoryCost: env.ARGON2_MEMORY_COST,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
  };
}

export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, options());
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify(hash, password, options());
  } catch {
    // A malformed stored hash must never authenticate anyone.
    return false;
  }
}

/** Temporary password issued to a customer account created by a rep. */
export function generateTemporaryPassword(): string {
  return `Sfs-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
}
