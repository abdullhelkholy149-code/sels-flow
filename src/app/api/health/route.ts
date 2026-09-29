import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STARTED_AT = Date.now();

type CheckName = 'database';
type CheckStatus = 'up' | 'down';

/**
 * Liveness/readiness probe.
 *
 * Returns 200 when the database answers, 503 otherwise, so the container
 * health check in docker-compose can use it directly.
 */
export async function GET() {
  const checks: Record<CheckName, CheckStatus> = { database: 'down' };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'up';
  } catch (error) {
    logger.error({ err: error }, 'health check: database unreachable');
  }

  const status = Object.values(checks).every((value) => value === 'up') ? 'ok' : 'degraded';

  return NextResponse.json(
    {
      status,
      service: 'salesflow',
      checks,
      uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
      timestamp: new Date().toISOString(),
    },
    {
      status: status === 'ok' ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
