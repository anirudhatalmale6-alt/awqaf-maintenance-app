/**
 * Centralized Gregorian (Miladi) date formatting helpers.
 *
 * Why this module exists:
 * - Some Arabic locales (ar-SA, ar-KW) default to the Hijri calendar on certain
 *   mobile devices or when the locale data isn't bundled, producing inconsistent
 *   dates between desktop and phone users.
 * - These helpers always force `calendar: 'gregory'` and a numbering system that
 *   renders Western digits, so dates look the same everywhere.
 */

/**
 * We use `en-GB` locale which always renders dd/MM/yyyy format with Western
 * digits and produces a clean LTR string that does not get mirrored inside
 * RTL (dir="rtl") containers.
 */
const BASE_LOCALE = 'en-GB';

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return d;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Format a date as Gregorian date only (e.g. 26/04/2026). */
export function formatGregorianDate(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' },
): string {
  const d = toDate(value);
  if (!d) return '';
  try {
    return d.toLocaleDateString(BASE_LOCALE, { ...options, calendar: 'gregory', numberingSystem: 'latn' });
  } catch {
    // Manual fallback: dd/MM/yyyy with Western digits
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
}

/** Format a date + time as Gregorian (e.g. 26/04/2026 14:05). */
export function formatGregorianDateTime(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  },
): string {
  const d = toDate(value);
  if (!d) return '';
  try {
    return d.toLocaleString(BASE_LOCALE, { ...options, calendar: 'gregory', numberingSystem: 'latn' });
  } catch {
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
}

/** Format only the time part (e.g. 14:05). */
export function formatGregorianTime(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false },
): string {
  const d = toDate(value);
  if (!d) return '';
  try {
    return d.toLocaleTimeString(BASE_LOCALE, { ...options, calendar: 'gregory', numberingSystem: 'latn' });
  } catch {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
}