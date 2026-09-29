import { describe, expect, it } from 'vitest';

import { parseEnv } from '@/config/env';

const minimalSource = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  AUTH_SECRET: 'a'.repeat(32),
  SIGNED_LINK_SECRET: 'b'.repeat(32),
  LOG_PRETTY: 'false',
} satisfies Record<string, string>;

describe('parseEnv', () => {
  it('applies safe defaults for everything optional', () => {
    const env = parseEnv(minimalSource);

    expect(env.PORT).toBe(3000);
    expect(env.WHATSAPP_ENABLED).toBe(false);
    expect(env.WHATSAPP_PROVIDER).toBe('console');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.ARGON2_MEMORY_COST).toBe(19456);
    expect(env.SIGNED_LINK_TTL_HOURS).toBe(168);
    expect(env.MAX_UPLOAD_SIZE_MB).toBe(5);
  });

  it('requires a database url', () => {
    expect(() => parseEnv({ ...minimalSource, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('requires secrets of at least 32 characters', () => {
    expect(() => parseEnv({ ...minimalSource, AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET/);
    expect(() => parseEnv({ ...minimalSource, SIGNED_LINK_SECRET: 'short' })).toThrow(
      /SIGNED_LINK_SECRET/,
    );
  });

  it('coerces booleans from strings, not from Boolean("false")', () => {
    expect(parseEnv({ ...minimalSource, WHATSAPP_ENABLED: 'true' }).WHATSAPP_ENABLED).toBe(true);
    expect(parseEnv({ ...minimalSource, WHATSAPP_ENABLED: 'false' }).WHATSAPP_ENABLED).toBe(false);
    expect(parseEnv({ ...minimalSource, WHATSAPP_ENABLED: '0' }).WHATSAPP_ENABLED).toBe(false);
    expect(parseEnv({ ...minimalSource, WHATSAPP_ENABLED: '1' }).WHATSAPP_ENABLED).toBe(true);
  });

  it('rejects a non numeric port instead of silently using NaN', () => {
    expect(() => parseEnv({ ...minimalSource, PORT: 'abc' })).toThrow();
  });

  it('refuses placeholder secrets in production', () => {
    expect(() =>
      parseEnv({
        ...minimalSource,
        NODE_ENV: 'production',
        AUTH_SECRET: `CHANGE_ME_${'x'.repeat(32)}`,
      }),
    ).toThrow(/AUTH_SECRET/);
  });

  it('refuses the console WhatsApp provider in production when WhatsApp is on', () => {
    expect(() =>
      parseEnv({ ...minimalSource, NODE_ENV: 'production', WHATSAPP_ENABLED: 'true' }),
    ).toThrow(/WHATSAPP_PROVIDER/);
  });

  it('allows the console provider in production while WhatsApp is off', () => {
    const env = parseEnv({ ...minimalSource, NODE_ENV: 'production', WHATSAPP_ENABLED: 'false' });
    expect(env.WHATSAPP_PROVIDER).toBe('console');
  });

  it('requires cloud credentials whenever the cloud provider is selected', () => {
    expect(() => parseEnv({ ...minimalSource, WHATSAPP_PROVIDER: 'cloud' })).toThrow(
      /WHATSAPP_ACCESS_TOKEN/,
    );
    expect(
      parseEnv({
        ...minimalSource,
        WHATSAPP_PROVIDER: 'cloud',
        WHATSAPP_PHONE_NUMBER_ID: '123',
        WHATSAPP_ACCESS_TOKEN: 'token',
      }).WHATSAPP_PROVIDER,
    ).toBe('cloud');
  });

  it('allows the console provider outside production', () => {
    const env = parseEnv({ ...minimalSource, NODE_ENV: 'development', WHATSAPP_ENABLED: 'true' });
    expect(env.WHATSAPP_PROVIDER).toBe('console');
  });
});
