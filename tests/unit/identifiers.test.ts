/**
 * Identifier normalization and the password policy (Section 3 and 4).
 */
import { describe, expect, it } from 'vitest';

import { checkPassword } from '@/lib/auth/password-policy';
import {
  isValidEgyptianPhone,
  normalizeLoginIdentifier,
  normalizePhone,
} from '@/lib/auth/identifiers';

describe('normalizePhone', () => {
  it('converts every Egyptian format to E.164', () => {
    // An Egyptian mobile is eleven local digits: 010/011/012/015 then eight
    // more. Every accepted spelling below is the same number.
    for (const input of [
      '01000000000',
      '+201000000000',
      '00201000000000',
      '20 100 000 0000',
      '201000000000',
    ]) {
      expect(normalizePhone(input)).toBe('+201000000000');
    }
  });

  it('strips spaces, dashes and brackets', () => {
    expect(normalizePhone('0100 000 0000')).toBe('+201000000000');
    expect(normalizePhone('+20 (100) 000-0000')).toBe('+201000000000');
    expect(normalizePhone('0100-000-0000')).toBe('+201000000000');
  });

  it('keeps a non zero international prefix intact', () => {
    expect(normalizePhone('+971501234567')).toBe('+971501234567');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizePhone('  01000000000 ')).toBe('+201000000000');
  });
});

describe('isValidEgyptianPhone', () => {
  it('accepts the mobile prefixes in use', () => {
    // Egyptian mobiles are 11 digits: 010/011/012/015 then eight more.
    for (const prefix of ['010', '011', '012', '015']) {
      expect(isValidEgyptianPhone(`${prefix}00000000`)).toBe(true);
      expect(isValidEgyptianPhone(`+20${prefix.slice(1)}00000000`)).toBe(true);
    }
  });

  it('rejects a landline, a short number and a non number', () => {
    expect(isValidEgyptianPhone('0200000000')).toBe(false);
    expect(isValidEgyptianPhone('010000000')).toBe(false);
    expect(isValidEgyptianPhone('abcdefghij')).toBe(false);
    expect(isValidEgyptianPhone('')).toBe(false);
  });

  it('rejects a number that is one digit too long', () => {
    expect(isValidEgyptianPhone('010000000000')).toBe(false);
  });
});

describe('normalizeLoginIdentifier', () => {
  it('normalizes a phone to E.164 and a username to lower case', () => {
    expect(normalizeLoginIdentifier('01000000000')).toBe('+201000000000');
    expect(normalizeLoginIdentifier('  Admin  ')).toBe('admin');
  });

  it('treats a digits only username as a phone, which is the documented behaviour', () => {
    expect(normalizeLoginIdentifier('201000000000')).toBe('+201000000000');
  });

  it('leaves a mixed username alone apart from case', () => {
    expect(normalizeLoginIdentifier('Rep_01')).toBe('rep_01');
  });
});

describe('checkPassword', () => {
  it('requires at least ten characters', () => {
    // Nine characters is one short; ten with three classes is accepted.
    expect(checkPassword('Ab1!efgh').ok).toBe(false);
    expect(checkPassword('Ab1!efghij').ok).toBe(true);
  });

  it('accepts a ten character password of three classes', () => {
    // Lower case + digits + symbol, exactly ten characters.
    expect(checkPassword('abcdefgh1!').ok).toBe(true);
  });

  it('rejects two character classes however long the password is', () => {
    expect(checkPassword('abcdefghijk12345').ok).toBe(false);
  });

  it('rejects a password longer than 128 characters', () => {
    expect(checkPassword(`${'aA1!'.repeat(40)}`).ok).toBe(false);
  });

  it('rejects the common passwords', () => {
    expect(checkPassword('password123').ok).toBe(false);
    expect(checkPassword('MyPassword1!').ok).toBe(false);
  });

  it('requires three of the four character classes', () => {
    // Lower case and digits only: two classes.
    expect(checkPassword('abcdefghij12').ok).toBe(false);
    // Adding upper case makes three.
    expect(checkPassword('Abcdefghij12').ok).toBe(true);
  });

  it('accepts a generated temporary password without demanding variety', () => {
    expect(checkPassword('Sfs-a1b2c3d4e5', true).ok).toBe(true);
  });

  it('always returns an Arabic message on failure', () => {
    const result = checkPassword('short');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/[؀-ۿ]/);
  });
});
