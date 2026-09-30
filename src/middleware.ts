import { NextResponse, type NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';

import { CSRF_COOKIE, CSRF_TTL_MINUTES_DEFAULT, SESSION_COOKIE } from '@/lib/auth/cookies';
import { routing } from '@/i18n/routing';

const intlMiddleware = createMiddleware(routing);

/**
 * Seeds the anonymous CSRF cookie for the login screen.
 *
 * It used to be written while the login page rendered, which Next forbids: a
 * cookie may only be set in a Server Action or a Route Handler, and the runtime
 * throws "Cookies can only be modified in a Server Action or Route Handler"
 * the moment a page render tries. The login screen therefore answered 500 and
 * was unreachable, while the unit and integration suites passed because neither
 * one renders a page. Middleware is the layer where writing a response cookie
 * is allowed, so the cookie is written here instead.
 *
 * Only when there is no session cookie. A signed in visitor's token comes from
 * the session row and is written at sign in with the same expiry as the session
 * cookie, so the two never drift; replacing it here with a token the server has
 * never seen would make every later form fail its CSRF check.
 *
 * `btoa` and `crypto.getRandomValues` rather than Buffer, because this runs on
 * the edge runtime where Buffer does not exist.
 */
function withAnonymousCsrf(request: NextRequest, response: NextResponse): NextResponse {
  if (request.cookies.has(CSRF_COOKIE)) return response;
  if (request.cookies.has(SESSION_COOKIE)) return response;

  const ttl = Number(process.env.CSRF_TTL_MINUTES ?? CSRF_TTL_MINUTES_DEFAULT);
  const minutes = Number.isFinite(ttl) && ttl > 0 ? ttl : CSRF_TTL_MINUTES_DEFAULT;

  response.cookies.set(CSRF_COOKIE, randomToken(), {
    // Readable by the client on purpose: it is the double submit half of the
    // token, and it is worthless without the httpOnly session.
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(minutes * 60),
  });
  return response;
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default function middleware(request: NextRequest) {
  return withAnonymousCsrf(request, intlMiddleware(request));
}

export const config = {
  // Skip API routes, Next internals and any file with an extension.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
