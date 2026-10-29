/** CSV export (RFC 4180), readable by Excel, Numbers and Google Sheets. */

/**
 * The separator spreadsheet apps expect for this locale: Excel opens a CSV with the system's list
 * separator, which is ";" wherever the decimal separator is a comma (French, German...).
 */
export function csvSeparator(locale?: string): ',' | ';' {
  try {
    const decimal = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')?.value;
    return decimal === ',' ? ';' : ',';
  } catch {
    return ',';
  }
}

/** Cells a spreadsheet would run as a formula ("=...", "+...", "-...", "@..."). */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: string | number | null | undefined, separator: string): string {
  let text = value == null ? '' : String(value);
  // Project files are third-party data: never let a banner name become a formula.
  if (FORMULA_START.test(text)) text = `'${text}`;
  return text.includes(separator) || /["\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows to CSV text, with CRLF line ends and a byte-order mark so Excel reads it as UTF-8. */
export function toCsv(rows: Array<Array<string | number | null | undefined>>, separator: ',' | ';' = ','): string {
  return '﻿' + rows.map((row) => row.map((v) => cell(v, separator)).join(separator)).join('\r\n') + '\r\n';
}

/** Hand a text file to the browser's downloads. */
export function downloadText(fileName: string, content: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
