/**
 * Background worker process.
 *
 * Runs as its own container (`docker compose` service `worker`). Handlers are
 * registered here as the phases that need them arrive, so this entry point
 * stays stable across phases.
 */
import { getEnv } from '@/config/env';
import { logger } from '@/lib/logger';
import { getBoss, JOB_NAMES } from '@/lib/queue';

async function main(): Promise<void> {
  const env = getEnv();
  const boss = await getBoss();

  logger.info(
    { nodeEnv: env.NODE_ENV, jobs: Object.values(JOB_NAMES) },
    'worker started and waiting for jobs',
  );

  // --- Phase 9: daily invoice due / overdue reminders ---------------------
  // await boss.schedule(JOB_NAMES.invoiceReminders, '0 6 * * *');
  //
  // --- Phase 9: outbound WhatsApp message delivery with retry -------------
  // await boss.work(JOB_NAMES.sendOutboxMessage, async ([job]) => {
  //   const { outboxMessageId } = job.data as SendOutboxMessagePayload;
  //   await deliverOutboxMessage(outboxMessageId);
  // });
  //
  // --- Phase 6: invoice PDF generation ------------------------------------
  // await boss.work(JOB_NAMES.generateInvoicePdf, async ([job]) => {
  //   const { invoiceId } = job.data as GenerateInvoicePdfPayload;
  //   await cacheInvoicePdf(invoiceId);
  // });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    await boss.stop({ graceful: true, timeout: 30_000 });
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  logger.fatal({ err: error }, 'worker failed to start');
  process.exit(1);
});
