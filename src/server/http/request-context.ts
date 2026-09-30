/**
 * Request metadata for the audit trail.
 *
 * It lives in its own module because every mutating action needs the same two
 * values, and a second copy of this logic is how the "we record the ip"
 * promise quietly stops being true on one screen.
 */
import { headers } from 'next/headers';

import { getEnv } from '@/config/env';

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

/**
 * IP and user agent for the audit trail.
 *
 * The forwarded header is only read when `TRUSTED_PROXY` is set (decision
 * D-015): otherwise any client could send `x-forwarded-for` and write a false ip
 * into the audit log. The ip is null rather than guessed when it cannot be
 * trusted, because a wrong address is worse than a missing one.
 */
export async function requestContext(): Promise<RequestContext> {
  const store = await headers();
  const ip = getEnv().TRUSTED_PROXY
    ? (store.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null)
    : null;
  return { ip, userAgent: store.get('user-agent') };
}
