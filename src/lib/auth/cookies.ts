/**
 * Cookie and field names shared by the server and the browser.
 *
 * This file has no server only imports on purpose: a client component that
 * renders the CSRF field needs the names, and importing them from a module that
 * touches `next/headers` or Prisma would drag those into the browser bundle.
 */
export const SESSION_COOKIE = 'sf_session';

/** Readable by the client: it is the double submit half of the CSRF token. */
export const CSRF_COOKIE = 'sf_csrf';

/** The form field, and the header for fetch based callers, that carries it. */
export const CSRF_FIELD = 'csrfToken';
export const CSRF_HEADER = 'x-csrf-token';
