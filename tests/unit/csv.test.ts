/**
 * CSV export helpers (Section 3: CSV export on every list screen).
 *
 * The escaping is the point of this file. A list screen exports values that a
 * customer typed, and Excel treats a leading `=`, `+`, `-` or `@` as the start
 * of a formula, so an unescaped export is a code execution path for whoever
 * opens it.
 */
import { describe, expect, it } from 'vitest';

import { csvCell, csvFilename, toCsv } from '@/lib/csv';

describe('csvCell', () => {
  it('wraps a plain value in quotes', () => {
    expect(csvCell('Ahmed')).toBe('"Ahmed"');
  });

  it('doubles an embedded quote, which is how CSV escapes one', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('keeps a separator or a newline inside the value', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('renders an absent value as an empty cell, not as "null"', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('writes a date as an unambiguous ISO string', () => {
    expect(csvCell(new Date('2026-03-01T10:00:00.000Z'))).toBe('"2026-03-01T10:00:00.000Z"');
  });

  describe('formula injection', () => {
    it.each([
      ['=1+1', 'an equals sign'],
      ['+1', 'a plus sign'],
      ['-1', 'a minus sign'],
      ['@SUM(A1)', 'an at sign'],
      ['\tcmd', 'a leading tab'],
      ['\rcmd', 'a leading carriage return'],
    ])('neutralises %s (%s)', (value) => {
      // Excel strips the leading apostrophe and shows the rest as text, so the
      // payload is visible but never executed.
      expect(csvCell(value)).toBe(`"'${value}"`);
    });

    it('leaves a value that only looks dangerous mid string alone', () => {
      expect(csvCell('total=5')).toBe('"total=5"');
    });
  });
});

describe('toCsv', () => {
  it('emits a header row, then one line per record', () => {
    const csv = toCsv(
      ['id', 'name'],
      [
        ['1', 'Ahmed'],
        ['2', 'Mona'],
      ],
    );

    expect(csv).toBe('\uFEFF"id","name"\r\n"1","Ahmed"\r\n"2","Mona"\r\n');
  });

  it('starts with a UTF-8 BOM so Excel detects Arabic', () => {
    // Without the BOM, Excel on Windows opens the file as Windows-1252 and the
    // Arabic comes out as mojibake.
    expect(toCsv(['name'], [['شركة']]).charCodeAt(0)).toBe(0xfeff);
  });

  it('emits only the header for an empty result set', () => {
    expect(toCsv(['id'], [])).toBe('\uFEFF"id"\r\n');
  });

  it('keeps a row with a missing value aligned with its header', () => {
    const [, row] = toCsv(['id', 'phone'], [['1', null]]).split('\r\n');
    // An absent value is a bare empty field, not `""` and not `null`: the
    // separator still has to be there or the following column shifts left.
    expect(row).toBe('"1",');
  });
});

describe('csvFilename', () => {
  it('stamps the name and drops the characters windows forbids', () => {
    // A colon is illegal in a Windows filename, and the ISO string contains one.
    expect(csvFilename('users', new Date('2026-03-01T10:00:00.000Z'))).toBe(
      'users-2026-03-01T10-00-00.csv',
    );
  });
});
