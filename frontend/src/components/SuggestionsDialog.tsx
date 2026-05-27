/**
 * SuggestionsDialog — a public-facing dialog for visitors and authenticated users
 * to submit suggestions, inquiries, complaints, or notes to the site administration.
 *
 * Shows:
 *  - A tab to submit a new message.
 *  - A tab (authenticated users only) to view their previous submissions and admin replies.
 *
 * Respects the global "suggestions_enabled" admin toggle: when disabled, the form
 * is hidden and a clear notice is shown.
 */
import { useEffect, useState } from 'react';
import { MessageSquare, Send, Loader2, Inbox, Check, Clock, Archive, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  useSubmitSuggestion,
  useSuggestionsEnabled,
  useMySuggestions,
  type SuggestionType,
  type SuggestionStatus,
} from '@/lib/useSuggestions';
import { useAuth } from '@/lib/AuthContext';

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

interface SuggestionsDialogProps {
  trigger?: React.ReactNode;
  /** If true, open the dialog automatically on mount. */
  defaultOpen?: boolean;
}

export function SuggestionsDialog({ trigger, defaultOpen = false }: SuggestionsDialogProps) {
  const [open, setOpen] = useState(defaultOpen);
  const { user } = useAuth();
  const isAuthed = !!user;

  const { enabled, loading: enabledLoading } = useSuggestionsEnabled();
  const { suggestions: mySuggestions, loading: myLoading, refetch: refetchMine } =
    useMySuggestions(isAuthed && open);
  const submitMutation = useSubmitSuggestion();

  const [type, setType] = useState<SuggestionType>('suggestion');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setTitle('');
      setContent('');
      setType('suggestion');
      if (!isAuthed) {
        setSenderName('');
        setSenderEmail('');
      }
    }
  }, [open, isAuthed]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();

    if (!trimmedTitle) {
      toast.error('الرجاء إدخال عنوان');
      return;
    }
    if (!trimmedContent) {
      toast.error('الرجاء إدخال التفاصيل');
      return;
    }
    if (!isAuthed && !senderName.trim()) {
      toast.error('الرجاء إدخال الاسم');
      return;
    }

    try {
      await submitMutation.mutateAsync({
        type,
        title: trimmedTitle,
        content: trimmedContent,
        sender_name: isAuthed ? undefined : senderName.trim(),
        sender_email: isAuthed ? undefined : senderEmail.trim() || undefined,
      });
      toast.success('تم إرسال رسالتك بنجاح. شكراً لتواصلك معنا!');
      setTitle('');
      setContent('');
      if (isAuthed) {
        refetchMine();
      } else {
        // Guests: close the dialog after sending
        setOpen(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر إرسال رسالتك';
      toast.error(msg);
    }
  };

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

  const content_disabled = !enabled && !enabledLoading;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="gap-2">
            <MessageSquare className="h-4 w-4" />
            <span>اقتراحاتكم</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            اقتراحاتكم واستفساراتكم
          </DialogTitle>
          <DialogDescription>
            نرحب بآرائكم وملاحظاتكم. نلتزم بالرد على جميع الرسائل بأسرع وقت ممكن.
          </DialogDescription>
        </DialogHeader>

        {content_disabled ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-6 text-center">
            <X className="mx-auto mb-3 h-10 w-10 text-amber-600 dark:text-amber-400" />
            <p className="font-semibold text-amber-700 dark:text-amber-300">
              خدمة إرسال الاقتراحات متوقفة مؤقتاً
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              سيتم إعادة تفعيل الخدمة قريباً. شكراً لصبركم.
            </p>
          </div>
        ) : isAuthed ? (
          <Tabs defaultValue="submit" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="submit">إرسال رسالة جديدة</TabsTrigger>
              <TabsTrigger value="mine" className="gap-2">
                رسائلي السابقة
                {mySuggestions.length > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {mySuggestions.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="submit" className="mt-4">
              <SubmitForm
                type={type}
                setType={setType}
                title={title}
                setTitle={setTitle}
                content={content}
                setContent={setContent}
                onSubmit={handleSubmit}
                submitting={submitMutation.isPending}
                isGuest={false}
              />
            </TabsContent>

            <TabsContent value="mine" className="mt-4">
              {myLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : mySuggestions.length === 0 ? (
                <div className="rounded-lg border border-dashed py-10 text-center text-muted-foreground">
                  <Inbox className="mx-auto mb-3 h-8 w-8 opacity-60" />
                  <p>لا توجد رسائل سابقة</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {mySuggestions.map((s) => {
                    const StatusIcon = STATUS_ICONS[s.status];
                    return (
                      <div
                        key={s.id}
                        className="rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
                      >
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-normal">
                              {TYPE_LABELS[s.type]}
                            </Badge>
                            <span
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[s.status]}`}
                            >
                              <StatusIcon className="h-3 w-3" />
                              {STATUS_LABELS[s.status]}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(s.created_at)}
                          </span>
                        </div>
                        <h4 className="mb-1 font-semibold text-foreground">{s.title}</h4>
                        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                          {s.content}
                        </p>
                        {s.admin_reply && (
                          <div className="mt-3 rounded-md border-l-4 border-primary bg-primary/5 p-3">
                            <p className="mb-1 text-xs font-semibold text-primary">
                              رد الإدارة
                              {s.replied_at && (
                                <span className="mx-2 font-normal text-muted-foreground">
                                  • {formatDate(s.replied_at)}
                                </span>
                              )}
                            </p>
                            <p className="whitespace-pre-wrap text-sm text-foreground">
                              {s.admin_reply}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
        ) : (
          <SubmitForm
            type={type}
            setType={setType}
            title={title}
            setTitle={setTitle}
            content={content}
            setContent={setContent}
            senderName={senderName}
            setSenderName={setSenderName}
            senderEmail={senderEmail}
            setSenderEmail={setSenderEmail}
            onSubmit={handleSubmit}
            submitting={submitMutation.isPending}
            isGuest={true}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface SubmitFormProps {
  type: SuggestionType;
  setType: (t: SuggestionType) => void;
  title: string;
  setTitle: (v: string) => void;
  content: string;
  setContent: (v: string) => void;
  senderName?: string;
  setSenderName?: (v: string) => void;
  senderEmail?: string;
  setSenderEmail?: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  submitting: boolean;
  isGuest: boolean;
}

function SubmitForm({
  type,
  setType,
  title,
  setTitle,
  content,
  setContent,
  senderName = '',
  setSenderName,
  senderEmail = '',
  setSenderEmail,
  onSubmit,
  submitting,
  isGuest,
}: SubmitFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {isGuest && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sug-name">الاسم *</Label>
            <Input
              id="sug-name"
              value={senderName}
              onChange={(e) => setSenderName?.(e.target.value)}
              placeholder="اسمك الكامل"
              required
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sug-email">البريد الإلكتروني (اختياري)</Label>
            <Input
              id="sug-email"
              type="email"
              value={senderEmail}
              onChange={(e) => setSenderEmail?.(e.target.value)}
              placeholder="example@mail.com"
              maxLength={200}
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="sug-type">نوع الرسالة</Label>
        <Select value={type} onValueChange={(v) => setType(v as SuggestionType)}>
          <SelectTrigger id="sug-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="suggestion">{TYPE_LABELS.suggestion}</SelectItem>
            <SelectItem value="inquiry">{TYPE_LABELS.inquiry}</SelectItem>
            <SelectItem value="complaint">{TYPE_LABELS.complaint}</SelectItem>
            <SelectItem value="note">{TYPE_LABELS.note}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="sug-title">العنوان *</Label>
        <Input
          id="sug-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="عنوان موجز يصف رسالتك"
          required
          maxLength={300}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sug-content">التفاصيل *</Label>
        <Textarea
          id="sug-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="اكتب تفاصيل رسالتك هنا..."
          required
          rows={6}
          maxLength={5000}
          className="resize-none"
        />
        <p className="text-xs text-muted-foreground">
          {content.length} / 5000 حرف
        </p>
      </div>

      <Button type="submit" disabled={submitting} className="w-full gap-2">
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            جارٍ الإرسال...
          </>
        ) : (
          <>
            <Send className="h-4 w-4" />
            إرسال الرسالة
          </>
        )}
      </Button>
    </form>
  );
}