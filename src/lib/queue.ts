/**
 * Background job queue.
 *
 * `pg-boss` keeps the queue inside PostgreSQL, which means one less service to
 * operate (see docs/DECISIONS.md D-004). The same schema is used by the web
 * process (to enqueue) and by the worker process (to consume).
 */
import PgBoss from 'pg-boss';

import { getEnv } from '@/config/env';
import { logger } from '@/lib/logger';

/** Job names. Every job name must exist here before it is enqueued anywhere. */
export const JOB_NAMES = {
  /** Daily sweep: invoice due soon / overdue reminders. */
  invoiceReminders: 'invoice-reminders',
  /** Retry a single outbound WhatsApp message. */
  sendOutboxMessage: 'send-outbox-message',
  /** Regenerate and cache an invoice PDF. */
  generateInvoicePdf: 'generate-invoice-pdf',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

export interface SendOutboxMessagePayload {
  outboxMessageId: string;
}

let boss: PgBoss | null = null;

/** Lazily creates the shared boss instance used to enqueue jobs. */
export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;

  const env = getEnv();
  const instance = new PgBoss({ connectionString: env.DATABASE_URL, schema: 'pgboss' });

  instance.on('error', (error) => logger.error({ err: error }, 'pg-boss error'));

  await instance.start();
  boss = instance;

  return instance;
}

export async function stopBoss(): Promise<void> {
  if (!boss) return;
  await boss.stop({ graceful: true, timeout: 30_000 });
  boss = null;
}
