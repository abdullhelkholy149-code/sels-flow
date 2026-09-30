/**
 * CSV export (Section 3: "Pagination, search, sorting, and CSV export on every
 * list screen").
 *
 * Two rules shape this file:
 *  - A cell that begins with `=`, `+`, `-`, `@`, a tab or a carriage return is
 *    a formula to Excel, not text. Such a value is prefixed with an apostrophe
 *    so a customer's name cannot become code that runs when an admin opens the
 *    export. This is CSV injection, and it is why the escaping is not optional.
 *  - UTF-8 with a BOM, because Excel on Windows otherwise reads Arabic as
 *    mojibake.
 */

const RISKY_PREFIX = /^[=+\-@\t\r]/;

/** Quotes a value for CSV, neutralising a leading formula character. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (RISKY_PREFIX.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Builds a CSV document from a header row and body rows. */
export function toCsv(headers: readonly string[], rows: readonly unknown[][]): string {
  const lines = [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))];
  // A BOM makes Excel detect UTF-8 without a user setting.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** A filename safe on every OS: no separators, no control characters. */
export function csvFilename(prefix: string, at: Date): string {
  const stamp = at.toISOString().slice(0, 19).replaceAll(':', '-');
  return `${prefix}-${stamp}.csv`;
}
