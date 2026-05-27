import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customApi } from './customApi';

export interface GuideFAQ {
  q: string;
  a: string;
}

/** Single entry in the "What's new" / changelog section. */
export interface GuideChangelogEntry {
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  /** Short human title, e.g. "دليل الاستخدام قابل للتعديل". */
  title: string;
  /** One-paragraph description of the feature/change. */
  description: string;
  /**
   * Category tag shown as a colored badge. One of:
   * "feature" (new feature), "improvement" (enhancement), "fix" (bug fix),
   * "security" (security-related), "other". Defaults to "feature" if empty.
   */
  type?: 'feature' | 'improvement' | 'fix' | 'security' | 'other';
}

/**
 * Editable content for the User Guide page.
 * All fields are optional — missing keys fall back to built-in defaults
 * defined inside the UserGuide page component, so the guide always stays
 * in sync with the latest features added to the code.
 */
export interface UserGuideContent {
  hero_title?: string;
  hero_subtitle?: string;

  intro_paragraphs?: string[];
  roles_intro?: string;
  track_intro?: string;
  track_items?: string[];
  report_detail_intro?: string;
  report_detail_tip?: string;
  notifications_intro?: string;
  notifications_items?: string[];
  messages_intro?: string;
  messages_items?: string[];
  online_users_intro?: string;
  online_users_items?: string[];
  engineer_intro?: string;
  engineer_tip?: string;
  contracts_intro?: string;
  contracts_steps?: string[];
  contracts_items?: string[];
  contracts_tip?: string;
  admin_intro?: string;
  admin_tip?: string;
  export_intro?: string;
  export_items?: string[];
  security_items?: string[];

  register_steps?: string[];
  login_steps?: string[];
  create_report_steps?: string[];
  engineer_steps?: string[];

  register_tip?: string;
  login_tip?: string;

  faqs?: GuideFAQ[];

  /**
   * Editable changelog entries. When empty / unset, the page falls back to
   * the built-in CHANGELOG list which is automatically updated by Alex each
   * time new features land.
   */
  changelog?: GuideChangelogEntry[];

  cta_title?: string;
  cta_description?: string;
}

const ENDPOINT = '/api/v1/app-settings/user-guide';

export function useUserGuideContent() {
  return useQuery<UserGuideContent>({
    queryKey: ['user-guide-content'],
    queryFn: async () => {
      try {
        const res = await customApi<UserGuideContent>(ENDPOINT, 'GET');
        if (res.ok && res.data && typeof res.data === 'object') return res.data;
        return {};
      } catch {
        return {};
      }
    },
    staleTime: 60_000,
    retry: 1,
  });
}

export function useUpdateUserGuideContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UserGuideContent) => {
      const res = await customApi<UserGuideContent>(ENDPOINT, 'PUT', payload);
      if (!res.ok) {
        throw new Error('تعذر حفظ التغييرات');
      }
      return res.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(['user-guide-content'], data);
    },
  });
}

/* ---------- Per-user changelog "seen" tracking ---------- */

/**
 * Server-computed status describing whether the current user has any
 * unread changelog entries in the User Guide. Used by the header to
 * show a red dot next to the "دليل الاستخدام" link.
 */
export interface ChangelogStatus {
  /** ISO date (YYYY-MM-DD) of the most recent changelog entry. */
  latest_date: string;
  /** ISO date of the last changelog entry this user has acknowledged, or null. */
  last_seen_date: string | null;
  /** True when latest_date > last_seen_date. */
  has_unseen: boolean;
}

const STATUS_ENDPOINT = '/api/v1/app-settings/user-guide/changelog-status';
const MARK_SEEN_ENDPOINT = '/api/v1/app-settings/user-guide/mark-seen';

/**
 * Polls the backend every ~60s for whether the current user has unseen
 * changelog entries. Only fires when `enabled` is true (pass false for
 * guests who aren't authenticated yet).
 */
export function useChangelogStatus(enabled: boolean = true) {
  return useQuery<ChangelogStatus>({
    queryKey: ['user-guide-changelog-status'],
    queryFn: async () => {
      const res = await customApi<ChangelogStatus>(STATUS_ENDPOINT, 'GET');
      if (res.ok && res.data) return res.data;
      return { latest_date: '', last_seen_date: null, has_unseen: false };
    },
    enabled,
    staleTime: 30_000,
    // Auto-refresh disabled per user request; manual refetch only.
    retry: 1,
  });
}

/** Marks the current user as having seen all changelog entries up to today. */
export function useMarkChangelogSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await customApi<ChangelogStatus>(MARK_SEEN_ENDPOINT, 'POST');
      if (!res.ok) throw new Error('تعذر تحديث حالة القراءة');
      return res.data;
    },
    onSuccess: (data) => {
      if (data) qc.setQueryData(['user-guide-changelog-status'], data);
      qc.invalidateQueries({ queryKey: ['user-guide-changelog-status'] });
    },
  });
}