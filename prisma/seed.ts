/**
 * Development seed.
 *
 * This is the ONLY file allowed to contain fake data (specification rule 5).
 * Phase 0 seeds the singleton company settings and the first administrator.
 * The full catalogue, reps, customers and a month of documents arrive in the
 * phase that introduces them.
 */
import { PrismaClient } from '@prisma/client';

import { getEnv } from '../src/config/env';
import { hashPassword } from '../src/lib/passwords';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const env = getEnv();

  await prisma.companySettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      legalName: 'شركة سالز فلو للتوزيع',
      taxRegistrationNumber: null,
      address: 'القاهرة، مصر',
      phone: '+201000000000',
      email: 'info@example.com',
      defaultVatRate: 14,
    },
    update: {},
  });

  const existingAdmin = await prisma.user.findUnique({
    where: { username: env.SEED_ADMIN_USERNAME },
  });

  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        role: 'ADMIN',
        username: env.SEED_ADMIN_USERNAME,
        phone: env.SEED_ADMIN_PHONE,
        email: null,
        passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
        mustChangePassword: true,
        isActive: true,
      },
    });
    process.stdout.write(`admin created (username=${env.SEED_ADMIN_USERNAME})\n`);
  } else {
    process.stdout.write('admin already exists, skipped\n');
  }

  const [users, settings] = await Promise.all([
    prisma.user.count(),
    prisma.companySettings.count(),
  ]);
  process.stdout.write(`seed done: users=${users} settings=${settings}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`seed failed: ${String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
