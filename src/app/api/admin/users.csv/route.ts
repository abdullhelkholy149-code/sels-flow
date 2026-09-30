/**
 * `GET /api/admin/users.csv`
 *
 * A route handler rather than a page, because a download must send a
 * `Content-Disposition` instead of HTML. The permission check is the same one
 * the screen uses: the export is not a way around the guard on the list.
 */
import { NextResponse } from 'next/server';

import { csvFilename } from '@/lib/csv';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { getSessionUser } from '@/server/auth/session';
import { assertPermission, loadActor } from '@/server/data/access';
import { exportUsersCsv } from '@/server/users/export';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const actor = await loadActor(session);
  try {
    assertPermission(actor, PERMISSIONS.USERS_READ);
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(request.url);
  const direction = url.searchParams.get('direction');
  const csv = await exportUsersCsv({
    search: url.searchParams.get('search') ?? undefined,
    sort: url.searchParams.get('sort') ?? undefined,
    direction: direction === 'asc' || direction === 'desc' ? direction : undefined,
  });

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFilename('users', new Date())}"`,
      'Cache-Control': 'no-store',
    },
  });
}
