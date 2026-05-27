/**
 * SuggestionsManager — Admin/Owner tab for managing suggestions, inquiries,
 * complaints, and notes submitted by users and guests.
 *
 * Features:
 *  - Toggle whether the public submission form is enabled
 *  - Filter by status and type
 *  - Reply to a message (auto-advances status to "replied")
 *  - Change status manually (new → reviewing → replied → closed)
 *  - Delete a message with confirmation
 */
import { useMemo, useState } from 'react';
import {
  MessageSquare,
  Inbox,
  Clock,
  Check,
  Archive,
  Trash2,
  Send,
  Loader2,
  Filter,
  Power,
  PowerOff,
  User as UserIcon,
  Mail,
  Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  useAllSuggestions,
  useDeleteSuggestion,
  useSetSuggestionsEnabled,
  useSuggestionsEnabled,
  useSuggestionsStats,
  useUpdateSuggestion,
  type Suggestion,
  type SuggestionStatus,
  type SuggestionType,
} from '@/lib/useSuggestions';

const TYPE_LABELS: Record<SuggestionType, string> = {
  suggestion: 'اقتراح',
  inquiry: 'استفسار',
  complaint: 'شكوى',
  note: 'ملاحظة',
};

const STATUS_LABELS: Record<SuggestionStatus, string> = {
  new: 'جديد',
  reviewing: 'قيد المراجعة',
  replied: 'تم الرد',
  closed: 'مغلق',
};

const STATUS_COLORS: Record<SuggestionStatus, string> = {
  new: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  reviewing: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  replied: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  closed: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30',
};

const STATUS_ICONS: Record<SuggestionStatus, typeof Clock> = {
  new: Inbox,
  reviewing: Clock,
  replied: Check,
  closed: Archive,
};

export function SuggestionsManager() {
  const [statusFilter, setStatusFilter] = useState<SuggestionStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<SuggestionType | 'all'>('all');
  const [deleteTarget, setDeleteTarget] = useState<Suggestion | null>(null);

  const { enabled, loading: enabledLoading } = useSuggestionsEnabled();
  const setEnabledMut = useSetSuggestionsEnabled();

  const { suggestions, loading, refetch } = useAllSuggestions({
    status: statusFilter === 'all' ? undefined : statusFilter,
    type: typeFilter === 'all' ? undefined : typeFilter,
  });
  const { stats } = useSuggestionsStats();

  const sortedSuggestions = useMemo(() => {
    // Put "new" and "reviewing" first, then by created_at desc
    const priority: Record<SuggestionStatus, number> = {
      new: 0,
      reviewing: 1,
      replied: 2,
      closed: 3,
    };
    return [...suggestions].sort((a, b) => {
      const p = priority[a.status] - priority[b.status];
      if (p !== 0) return p;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [suggestions]);

  const handleToggleEnabled = async (next: boolean) => {
    try {
      await setEnabledMut.mutateAsync(next);
      toast.success(next ? 'تم تفعيل خدمة الاقتراحات' : 'تم إيقاف خدمة الاقتراحات');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر تحديث الحالة');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header / toggle */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              إدارة الاقتراحات والاستفسارات
            </CardTitle>
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2">
              {enabled ? (
                <Power className="h-4 w-4 text-emerald-600" />
              ) : (
                <PowerOff className="h-4 w-4 text-muted-foreground" />
              )}
              <Label htmlFor="sug-toggle" className="cursor-pointer text-sm font-medium">
                استقبال الرسائل
              </Label>
              <Switch
                id="sug-toggle"
                checked={enabled}
                onCheckedChange={handleToggleEnabled}
                disabled={enabledLoading || setEnabledMut.isPending}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="جديد" value={stats.new} icon={Inbox} color="blue" />
            <StatCard label="قيد المراجعة" value={stats.reviewing} icon={Clock} color="amber" />
            <StatCard label="تم الرد" value={stats.replied} icon={Check} color="emerald" />
            <StatCard label="مغلق" value={stats.closed} icon={Archive} color="slate" />
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Filter className="h-4 w-4" />
          تصفية:
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            <SelectItem value="new">{STATUS_LABELS.new}</SelectItem>
            <SelectItem value="reviewing">{STATUS_LABELS.reviewing}</SelectItem>
            <SelectItem value="replied">{STATUS_LABELS.replied}</SelectItem>
            <SelectItem value="closed">{STATUS_LABELS.closed}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الأنواع</SelectItem>
            <SelectItem value="suggestion">{TYPE_LABELS.suggestion}</SelectItem>
            <SelectItem value="inquiry">{TYPE_LABELS.inquiry}</SelectItem>
            <SelectItem value="complaint">{TYPE_LABELS.complaint}</SelectItem>
            <SelectItem value="note">{TYPE_LABELS.note}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={loading}>
          تحديث
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : sortedSuggestions.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-muted-foreground">
          <Inbox className="mx-auto mb-3 h-10 w-10 opacity-50" />
          <p>لا توجد رسائل تطابق التصفية الحالية</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedSuggestions.map((s) => (
            <SuggestionItem
              key={s.id}
              suggestion={s}
              onRequestDelete={() => setDeleteTarget(s)}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الرسالة؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف الرسالة نهائياً ولا يمكن التراجع. هل أنت متأكد؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <DeleteConfirmButton
              target={deleteTarget}
              onDone={() => setDeleteTarget(null)}
            />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface SuggestionItemProps {
  suggestion: Suggestion;
  onRequestDelete: () => void;
}

function SuggestionItem({ suggestion, onRequestDelete }: SuggestionItemProps) {
  const [replyDraft, setReplyDraft] = useState(suggestion.admin_reply || '');
  const [expanded, setExpanded] = useState(
    suggestion.status === 'new' || suggestion.status === 'reviewing',
  );

  const updateMut = useUpdateSuggestion();
  const StatusIcon = STATUS_ICONS[suggestion.status];

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('ar-EG-u-ca-gregory-nu-latn', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return iso;
    }
  };

  const handleChangeStatus = async (next: SuggestionStatus) => {
    try {
      await updateMut.mutateAsync({ id: suggestion.id, status: next });
      toast.success('تم تحديث الحالة');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر التحديث');
    }
  };

  const handleSendReply = async () => {
    const trimmed = replyDraft.trim();
    if (!trimmed) {
      toast.error('الرجاء كتابة الرد');
      return;
    }
    try {
      await updateMut.mutateAsync({
        id: suggestion.id,
        admin_reply: trimmed,
      });
      toast.success('تم إرسال الرد');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر إرسال الرد');
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-normal">
              {TYPE_LABELS[suggestion.type]}
            </Badge>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[suggestion.status]}`}
            >
              <StatusIcon className="h-3 w-3" />
              {STATUS_LABELS[suggestion.status]}
            </span>
            {suggestion.user_id && (
              <Badge variant="secondary" className="font-normal">
                مستخدم مسجّل
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs"
            >
              {expanded ? 'طيّ' : 'توسيع'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRequestDelete}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <h4 className="mb-2 font-semibold text-foreground">{suggestion.title}</h4>

        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {suggestion.sender_name && (
            <span className="inline-flex items-center gap-1">
              <UserIcon className="h-3 w-3" />
              {suggestion.sender_name}
            </span>
          )}
          {suggestion.sender_email && (
            <a
              href={`mailto:${suggestion.sender_email}`}
              className="inline-flex items-center gap-1 hover:text-primary hover:underline"
            >
              <Mail className="h-3 w-3" />
              {suggestion.sender_email}
            </a>
          )}
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatDate(suggestion.created_at)}
          </span>
        </div>

        {expanded && (
          <>
            <div className="mb-4 rounded-md bg-muted/40 p-3">
              <p className="whitespace-pre-wrap text-sm text-foreground">
                {suggestion.content}
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor={`reply-${suggestion.id}`} className="text-sm">
                  رد الإدارة
                </Label>
                <Textarea
                  id={`reply-${suggestion.id}`}
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value)}
                  placeholder="اكتب ردك هنا..."
                  rows={3}
                  maxLength={5000}
                  className="resize-none"
                />
                {suggestion.replied_at && (
                  <p className="text-xs text-muted-foreground">
                    آخر رد في {formatDate(suggestion.replied_at)}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Label className="text-sm text-muted-foreground">الحالة:</Label>
                  <Select
                    value={suggestion.status}
                    onValueChange={(v) => handleChangeStatus(v as SuggestionStatus)}
                    disabled={updateMut.isPending}
                  >
                    <SelectTrigger className="h-8 w-[140px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">{STATUS_LABELS.new}</SelectItem>
                      <SelectItem value="reviewing">{STATUS_LABELS.reviewing}</SelectItem>
                      <SelectItem value="replied">{STATUS_LABELS.replied}</SelectItem>
                      <SelectItem value="closed">{STATUS_LABELS.closed}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  onClick={handleSendReply}
                  disabled={updateMut.isPending || !replyDraft.trim()}
                  className="gap-2"
                >
                  {updateMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  إرسال الرد
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface DeleteConfirmButtonProps {
  target: Suggestion | null;
  onDone: () => void;
}

function DeleteConfirmButton({ target, onDone }: DeleteConfirmButtonProps) {
  const deleteMut = useDeleteSuggestion();

  const handleClick = async () => {
    if (!target) return;
    try {
      await deleteMut.mutateAsync(target.id);
      toast.success('تم حذف الرسالة');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر الحذف');
    }
  };

  return (
    <AlertDialogAction
      onClick={handleClick}
      disabled={deleteMut.isPending}
      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
    >
      {deleteMut.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        'حذف'
      )}
    </AlertDialogAction>
  );
}

interface StatCardProps {
  label: string;
  value: number;
  icon: typeof Clock;
  color: 'blue' | 'amber' | 'emerald' | 'slate';
}

function StatCard({ label, value, icon: Icon, color }: StatCardProps) {
  const colorClasses: Record<StatCardProps['color'], string> = {
    blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
    amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
    slate: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20',
  };

  return (
    <div className={`rounded-lg border p-3 ${colorClasses[color]}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{label}</span>
        <Icon className="h-4 w-4 opacity-70" />
      </div>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}