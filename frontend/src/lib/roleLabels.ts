/**
 * Helper for displaying user role keys as Arabic labels.
 *
 * The backend stores roles as short English keys (admin, owner, engineer, ...)
 * but the UI should always present the localized Arabic label to end users.
 * Use `getRoleLabel(roleKey)` whenever you need to render a role next to a
 * user's name, in a badge, in a dropdown, etc.
 *
 * If a key isn't in the map (e.g. a custom role created from the admin panel
 * with a non-standard `value`), we fall back to the raw key so the UI still
 * shows something rather than a blank.
 */
const ROLE_LABELS_AR: Record<string, string> = {
  admin: "مدير",
  owner: "مالك",
  engineer: "مهندس",
  supervisor: "مشرف",
  monitor: "مراقب بلاغات",
  user: "مستخدم",
  disabled: "معطّل",
};

export function getRoleLabel(roleKey?: string | null): string {
  if (!roleKey) return "";
  const trimmed = String(roleKey).trim();
  if (!trimmed) return "";
  return ROLE_LABELS_AR[trimmed] || trimmed;
}

export const ROLE_LABELS = ROLE_LABELS_AR;