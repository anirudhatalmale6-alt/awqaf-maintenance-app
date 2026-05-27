export interface ReportSplitSummaryItem {
  id: number;
  engineer?: string | null;
  entity?: string | null;
  category?: string | null;
  status: string;
}

export interface ReportSplitsSummary {
  count: number;
  engineers: string[];
  entities: string[];
  categories: string[];
  items: ReportSplitSummaryItem[];
}

export interface Report {
  id: number;
  user_id: string;
  title: string;
  description?: string | null;
  category: string;
  priority: string;
  status: string;
  reporter_name?: string | null;
  reporter_phone?: string | null;
  reporter_role?: string | null;
  region?: string | null;
  mosque_name?: string | null;
  assigned_engineer?: string | null;
  assigned_engineer_name?: string | null;
  executing_entity?: string | null;
  estimated_cost?: number | null;
  status_changed_by?: string | null;
  status_changed_by_name?: string | null;
  created_at: string | null;
  updated_at: string | null;
  shared_by?: string;
  shared_by_name?: string | null;
  created_by_username?: string | null;
  is_split?: boolean;
  splits_summary?: ReportSplitsSummary | null;
}

export const REPORTER_ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'إمام', label: 'إمام' },
  { value: 'مؤذن', label: 'مؤذن' },
  { value: 'من رواد المسجد', label: 'من رواد المسجد' },
  { value: '-', label: '-' },
];

export interface MosqueData {
  id: number;
  name: string;
  region_id: number;
}

export interface RegionWithMosques {
  id: number;
  name: string;
  mosques: MosqueData[];
}

export interface ReportImage {
  id: number;
  user_id: string;
  report_id: number;
  object_key: string;
  file_name: string;
  created_at: string | null;
}

export interface Notification {
  id: number;
  user_id: string;
  type: string;
  message: string;
  report_id: number;
  is_read: boolean;
  created_at: string | null;
}

export interface Message {
  id: number;
  sender_id: string;
  sender_name?: string;
  receiver_id: string;
  receiver_name?: string;
  content: string;
  is_read: boolean;
  parent_id?: number | null;
  parent_preview?: string | null;
  created_at: string | null;
}

export interface Conversation {
  user_id: string;
  user_name: string;
  last_message: string;
  last_message_time: string | null;
  unread_count: number;
  is_sender: boolean;
}

export interface BroadcastMessage {
  id: number;
  sender_id: string;
  sender_name?: string;
  subject: string;
  content: string;
  target_type: string;
  target_value?: string;
  target_label?: string;
  is_read: boolean;
  created_at: string | null;
}

export interface BroadcastRole {
  value: string;
  label: string;
  color: string;
  user_count: number;
}

export interface ReportNote {
  id: number;
  report_id: number;
  user_id: string;
  user_name: string;
  user_specialization: string | null;
  content: string;
  parent_id: number | null;
  is_edited: boolean;
  edited_at: string | null;
  created_at: string | null;
  replies: ReportNote[];
}

export interface UserItem {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  member_tag: string | null;
}

export type ReportStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type ReportPriority = 'بسيطة' | 'جذرية' | 'جذري' | 'بسيط';
export type ReportCategory = 'مدني' | 'تكييف' | 'كهرباء' | 'صوتيات' | 'زراعه' | 'نظافة' | 'اخرى';

export const STATUS_OPTIONS: { value: ReportStatus; label: string }[] = [
  { value: 'open', label: 'بلاغ جديد' },
  { value: 'in_progress', label: 'قيد التنفيذ' },
  { value: 'resolved', label: 'تم الحل' },
  { value: 'closed', label: 'مغلق' },
];

export const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'بسيطة', label: 'بسيطة' },
  { value: 'جذرية', label: 'جذرية' },
  { value: 'جذري', label: 'جذري' },
  { value: 'بسيط', label: 'بسيط' },
];

export const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'مدني', label: 'مدني' },
  { value: 'تكييف', label: 'تكييف' },
  { value: 'كهرباء', label: 'كهرباء' },
  { value: 'صوتيات', label: 'صوتيات' },
  { value: 'زراعه', label: 'زراعه' },
  { value: 'نظافة', label: 'نظافة' },
  { value: 'اخرى', label: 'اخرى' },
];

export const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-amber-100 text-amber-800',
  resolved: 'bg-green-100 text-green-800',
  closed: 'bg-gray-100 text-gray-800',
};

export const PRIORITY_COLORS: Record<string, string> = {
  'بسيطة': 'bg-slate-100 text-slate-700',
  'جذرية': 'bg-red-100 text-red-800',
  'جذري': 'bg-orange-100 text-orange-800',
  'بسيط': 'bg-yellow-100 text-yellow-800',
};

export const STATUS_LABELS: Record<string, string> = {
  open: 'بلاغ جديد',
  in_progress: 'قيد التنفيذ',
  resolved: 'تم الحل',
  closed: 'مغلق',
};