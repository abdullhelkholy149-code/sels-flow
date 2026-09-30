/**
 * `GET /api/admin/audit.csv`
 *
 * See the users export: same permission gate as the screen, and a
 * `Content-Disposition` so the browser downloads instead of rendering.
 */
import { AuditAction } from '@prisma/client';
import { NextResponse } from 'next/server';

import { PERMISSIONS } from '@/lib/auth/permissions';
import { csvFilename } from '@/lib/csv';
import { getSessionUser } from '@/server/auth/session';
import { exportAuditCsv } from '@/server/audit/export';
import { assertPermission, loadActor } from '@/server/data/access';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const actor = await loadActor(session);
  try {
    assertPermission(actor, PERMISSIONS.AUDIT_READ);
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const csv = await exportAuditCsv({
    action:
      action && (Object.values(AuditAction) as string[]).includes(action)
        ? (action as AuditAction)
        : 'ALL',
    entityType: url.searchParams.get('entityType') ?? undefined,
  });

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFilename('audit', new Date())}"`,
      'Cache-Control': 'no-store',
    },
  });
}
