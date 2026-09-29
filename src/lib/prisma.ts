/**
 * Prisma client singleton plus the transaction helper used by every money and
 * stock mutation (Section 3: all stock/invoice/balance changes run inside a
 * transaction with row locks).
 */
import { PrismaClient, type Prisma } from '@prisma/client';

import { getEnv } from '@/config/env';
import { logger } from '@/lib/logger';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  // Touch the environment so misconfiguration fails fast, not on first query.
  getEnv();

  return new PrismaClient({
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

prisma.$on('warn', (event) => {
  logger.warn({ target: event.target }, 'prisma warning');
});

prisma.$on('error', (event) => {
  logger.error({ target: event.target }, 'prisma error');
});

export type Tx = Prisma.TransactionClient;

/**
 * Runs `fn` inside a database transaction. Money and stock mutations must never
 * run outside this helper.
 *
 * Isolation level is `ReadCommitted` on purpose: row level locks
 * (`SELECT ... FOR UPDATE`) are the mechanism used for concurrency, and
 * `Serializable` would add serialization failures without adding safety.
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => fn(tx), {
    maxWait: 5_000,
    timeout: 15_000,
    isolationLevel: 'ReadCommitted',
  });
}
