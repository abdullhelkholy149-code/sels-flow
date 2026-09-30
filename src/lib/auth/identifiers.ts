/**
 * Phone normalization and validation (Section 3: stored in E.164, Egyptian
 * mobile formats accepted).
 *
 * Kept pure and dependency free so it can be unit tested without a database.
 *
 * Accepted inputs, all normalizing to the same value:
 *   0100000000  0100 000 0000  +201000000000  0020 10 000 0000  201000000000
 */

const EGYPT_COUNTRY = '20';
/** Egyptian mobile network prefixes: 010, 011, 012, 015. */
const EGYPT_MOBILE = /^1[0125][0-9]{8}$/;

/** Keeps digits and a single leading `+`; drops spaces, dashes and brackets. */
function strip(input: string): string {
  const cleaned = input.trim().replace(/[\s().-]/g, '');
  return cleaned.startsWith('+')
    ? `+${cleaned.slice(1).replace(/\D/g, '')}`
    : cleaned.replace(/\D/g, '');
}

/**
 * Converts any accepted Egyptian format to E.164 (`+2010XXXXXXXX`).
 *
 * A non Egyptian number is returned with the `+` and its own country code
 * intact, so an international contact is never silently mangled into an
 * Egyptian one.
 */
export function normalizePhone(input: string): string {
  const digits = strip(input);
  if (digits.length === 0) return '';

  if (digits.startsWith('+')) {
    return `+${stripNational(digits.slice(1))}`;
  }

  // 0020... is the same international prefix written without the plus.
  if (digits.startsWith('00')) {
    return `+${stripNational(digits.slice(2))}`;
  }

  // 20... already carries the country code.
  if (digits.startsWith(EGYPT_COUNTRY)) {
    return `+${stripNational(digits)}`;
  }

  // 0 is the national trunk prefix: it becomes the country code.
  if (digits.startsWith('0')) {
    return `+${EGYPT_COUNTRY}${stripNational(digits.slice(1))}`;
  }

  // 1xxxxxxxxx is the national form written without the trunk prefix.
  if (digits.startsWith('1')) {
    return `+${EGYPT_COUNTRY}${digits}`;
  }

  return `+${EGYPT_COUNTRY}${digits}`;
}

function stripNational(digits: string): string {
  return digits.replace(/^0+/, '');
}

/** True for an Egyptian mobile number, in any accepted input format. */
export function isValidEgyptianPhone(input: string): boolean {
  const digits = strip(input);
  const national = digits
    .replace(/^\+/, '')
    .replace(/^00/, '')
    .replace(new RegExp(`^${EGYPT_COUNTRY}`), '')
    .replace(/^0/, '');

  return EGYPT_MOBILE.test(national);
}

/** Phone numbers and usernames share one field, so normalize both for lookup. */
export function normalizeLoginIdentifier(input: string): string {
  const trimmed = input.trim();
  // Only a purely numeric identifier is treated as a phone; anything with a
  // letter is a username and is only case folded.
  if (/^\+?[\d\s().-]+$/.test(trimmed) && /\d/.test(trimmed)) {
    return normalizePhone(trimmed);
  }
  return trimmed.toLowerCase();
}
