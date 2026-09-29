import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cn } from '@/lib/cn';
import {
  APP_NAME,
  CURRENCY,
  DISPLAY_TIME_ZONE,
  MONEY_DECIMAL_PLACES,
  QUANTITY_DECIMAL_PLACES,
  STORAGE_TIME_ZONE,
} from '@/lib/constants';

describe('cn', () => {
  it('joins class names and drops falsy values', () => {
    expect(cn('a', false, undefined, 'b', null, 'c')).toBe('a b c');
  });

  it('returns an empty string when nothing is provided', () => {
    expect(cn()).toBe('');
  });
});

describe('global conventions', () => {
  it('stores money with two decimals and quantities with three', () => {
    expect(MONEY_DECIMAL_PLACES).toBe(2);
    expect(QUANTITY_DECIMAL_PLACES).toBe(3);
  });

  it('stores in UTC and displays in Africa/Cairo', () => {
    expect(STORAGE_TIME_ZONE).toBe('UTC');
    expect(DISPLAY_TIME_ZONE).toBe('Africa/Cairo');
  });

  it('trades in Egyptian pounds', () => {
    expect(CURRENCY).toBe('EGP');
  });

  it('exposes a product name', () => {
    expect(APP_NAME.length).toBeGreaterThan(0);
  });
});

/**
 * A UTF-8 byte order mark is invisible in an editor but PostgreSQL rejects it
 * at the start of a statement, so `prisma migrate deploy` fails on any machine
 * where the file was written by a tool that adds a BOM. It is checked here
 * because the failure only shows up on the CI runner or in production.
 */
describe('migration files', () => {
  const migrationsDir = join(process.cwd(), 'prisma', 'migrations');

  function sqlFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);

      if (statSync(path).isDirectory()) {
        return sqlFiles(path);
      }

      return path.endsWith('.sql') ? [path] : [];
    });
  }

  const files = sqlFiles(migrationsDir);

  it('finds the committed migrations', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('has no byte order mark', () => {
    for (const file of files) {
      const bytes = readFileSync(file);

      expect(
        bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
        `${file} starts with a UTF-8 BOM`,
      ).toBe(false);
    }
  });

  it('commits the migration lock file', () => {
    // Prisma refuses to apply migrations when this file is missing.
    expect(statSync(join(migrationsDir, 'migration_lock.toml')).isFile()).toBe(true);
  });
});
