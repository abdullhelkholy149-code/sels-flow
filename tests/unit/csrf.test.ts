/**
 * CSRF double submit verification.
 *
 * The rule being tested: a mutating form is only honoured when the hidden field
 * equals the token the server already holds. A cross site request can cause the
 * browser to send the cookie, but it cannot read the cookie, so it cannot
 * produce a matching field.
 */
import { describe, expect, it } from 'vitest';

import { CSRF_FIELD } from '@/lib/auth/cookies';

const { CsrfError, verifyCsrfField } = await import('@/server/auth/session');
const { CSRF_COOKIE } = await import('@/lib/auth/cookies');

// A realistic token: 32 random bytes, base64url.
const TOKEN = 'kZ3vN8pQ2rT7wX1yB5cD9fH0jL4mA6s';
const OTHER = 'aZ3vN8pQ2rT7wX1yB5cD9fH0jL4mA6s';

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function submitted(data: FormData): FormDataEntryValue | null {
  return data.get(CSRF_FIELD);
}

describe('verifyCsrfField', () => {
  it('accepts a field that matches the stored token', () => {
    expect(() => verifyCsrfField(submitted(form({ [CSRF_FIELD]: TOKEN })), TOKEN)).not.toThrow();
  });

  it('rejects a field that does not match', () => {
    expect(() => verifyCsrfField(submitted(form({ [CSRF_FIELD]: OTHER })), TOKEN)).toThrow(
      CsrfError,
    );
  });

  it('rejects a request with no field at all', () => {
    expect(() => verifyCsrfField(submitted(form({ userId: 'x' })), TOKEN)).toThrow(CsrfError);
  });

  it('rejects an empty field', () => {
    expect(() => verifyCsrfField('', TOKEN)).toThrow(CsrfError);
  });

  it('rejects a value that is too short to be a real token', () => {
    // A one character guess must not reach the comparison at all, so the check
    // cannot be turned into an oracle by timing.
    expect(() => verifyCsrfField('a', TOKEN)).toThrow(CsrfError);
  });

  it('rejects when the server holds no token, so a cleared cookie is not a bypass', () => {
    expect(() => verifyCsrfField(TOKEN, null)).toThrow(CsrfError);
    expect(() => verifyCsrfField(TOKEN, undefined)).toThrow(CsrfError);
    expect(() => verifyCsrfField(TOKEN, '')).toThrow(CsrfError);
  });

  it('rejects a file rather than a string', () => {
    const data = new FormData();
    data.append(CSRF_FIELD, new Blob(['x']));
    expect(() => verifyCsrfField(data.get(CSRF_FIELD), TOKEN)).toThrow(CsrfError);
  });

  it('rejects a prefix of a valid token', () => {
    expect(() => verifyCsrfField(TOKEN.slice(0, -1), TOKEN)).toThrow(CsrfError);
  });

  it('rejects a token with one character changed', () => {
    expect(() => verifyCsrfField(OTHER, TOKEN)).toThrow(CsrfError);
  });

  it('keeps the cookie name out of the form field name', () => {
    // The field is a form control and the cookie is a header-ish name; mixing
    // them up would mean a form posting the cookie name by accident.
    expect(CSRF_COOKIE).not.toBe(CSRF_FIELD);
  });
});
