/**
 * Format a Kuwaiti Dinar (KWD) numeric value for display.
 *
 * Removes trailing zeros after the decimal point so that whole-number amounts
 * render cleanly (e.g. "1,500" instead of "1,500.000"), while preserving up to
 * 3 fractional digits when they are meaningful (KWD has 3 fils precision).
 *
 * Examples:
 *   formatKWD(1500)       -> "1,500 د.ك"
 *   formatKWD(1500.5)     -> "1,500.5 د.ك"
 *   formatKWD(1500.75)    -> "1,500.75 د.ك"
 *   formatKWD(1500.123)   -> "1,500.123 د.ك"
 *   formatKWD(null)       -> ""
 *   formatKWD(0)          -> ""  (unless showZero=true)
 *   formatKWD(1500, { withSuffix: false }) -> "1,500"
 */
export function formatKWD(
  value: number | string | null | undefined,
  options?: { showZero?: boolean; withSuffix?: boolean },
): string {
  const showZero = options?.showZero ?? false;
  const withSuffix = options?.withSuffix ?? true;

  if (value === null || value === undefined || value === "") return "";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(num)) return "";
  if (num === 0 && !showZero) return "";

  // Round to KWD precision (3 fractional digits) then strip trailing zeros.
  const rounded = Math.round(num * 1000) / 1000;
  const fixed = rounded.toFixed(3); // e.g. "1500.500"
  // Strip trailing zeros and a dangling decimal point.
  const trimmed = fixed.replace(/\.?0+$/, "");
  const [intPart, decPart] = trimmed.split(".");
  const intWithSep = parseInt(intPart, 10).toLocaleString("en-US");
  const formatted = decPart ? `${intWithSep}.${decPart}` : intWithSep;

  return withSuffix ? `${formatted} د.ك` : formatted;
}