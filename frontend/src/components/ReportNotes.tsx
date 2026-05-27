import { useState, useEffect } from 'react';
import { customApi } from '@/lib/customApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  MessageSquarePlus,
  Trash2,
  User,
  Clock,
  StickyNote,
  Pencil,
  Reply,
  Check,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ReportNote } from '@/lib/types';

interface ReportNotesProps {
  reportId: number;
  isAdmin: boolean;
  currentUserId?: string;
  canAddNotes?: boolean;
}

export default function ReportNotes({ reportId, isAdmin, currentUserId, canAddNotes }: ReportNotesProps) {
  const canAdd = canAddNotes ?? isAdmin;
  const [notes, setNotes] = useState<ReportNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchNotes();
  }, [reportId]);

  const fetchNotes = async () => {
    try {
      setLoading(true);
      const res = await customApi<ReportNote[]>(`/api/v1/report-notes/${reportId}`, 'GET');
      setNotes(res.data || []);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  const handleAddNote = async (parentId?: number) => {
    const content = parentId ? undefined : newNote;
    if (!parentId && !newNote.trim()) {
      toast.error('يرجى كتابة الملاحظة');
      return;
    }
    if (!parentId) {
      try {
        setSubmitting(true);
        const res = await customApi<ReportNote>('/api/v1/report-notes/add', 'POST', {
          report_id: reportId,
          content: newNote.trim(),
          parent_id: null,
        });
        if (res.data) {
          setNotes((prev) => [{ ...res.data, replies: [] }, ...prev]);
          setNewNote('');
          toast.success('تم إضافة الملاحظة بنجاح');
        }
      } catch {
        toast.error('فشل في إضافة الملاحظة');
      } finally {
        setSubmitting(false);
      }
    }
    return content;
  };

  const handleAddReply = async (parentId: number, replyContent: string) => {
    if (!replyContent.trim()) {
      toast.error('يرجى كتابة الرد');
      return false;
    }
    try {
      const res = await customApi<ReportNote>('/api/v1/report-notes/add', 'POST', {
        report_id: reportId,
        content: replyContent.trim(),
        parent_id: parentId,
      });
      if (res.data) {
        // Re-fetch to get proper tree structure
        await fetchNotes();
        toast.success('تم إضافة الرد بنجاح');
        return true;
      }
    } catch {
      toast.error('فشل في إضافة الرد');
    }
    return false;
  };

  const handleEditNote = async (noteId: number, content: string) => {
    if (!content.trim()) {
      toast.error('محتوى الملاحظة مطلوب');
      return false;
    }
    try {
      const res = await customApi<ReportNote>('/api/v1/report-notes/edit', 'POST', {
        note_id: noteId,
        content: content.trim(),
      });
      if (res.data) {
        await fetchNotes();
        toast.success('تم تعديل الملاحظة بنجاح');
        return true;
      }
    } catch {
      toast.error('فشل في تعديل الملاحظة');
    }
    return false;
  };

  const handleDeleteNote = async (noteId: number) => {
    if (!confirm('هل أنت متأكد من حذف هذه الملاحظة؟')) return;
    try {
      await customApi('/api/v1/report-notes/delete', 'POST', { note_id: noteId });
      await fetchNotes();
      toast.success('تم حذف الملاحظة');
    } catch {
      toast.error('فشل في حذف الملاحظة');
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleString('ar-EG-u-ca-gregory-nu-latn', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
        <StickyNote className="h-4 w-4" />
        الملاحظات ({notes.length})
      </h3>

      {/* Add note form - for users with add_report_notes permission */}
      {canAdd && (
        <div className="space-y-2">
          <Textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="اكتب ملاحظة جديدة..."
            className="min-h-[80px] resize-none text-right"
            dir="rtl"
          />
          <div className="flex justify-end">
            <Button
              onClick={() => handleAddNote()}
              disabled={submitting || !newNote.trim()}
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {submitting ? (
                <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full ml-2" />
              ) : (
                <MessageSquarePlus className="h-4 w-4 ml-2" />
              )}
              إضافة ملاحظة
            </Button>
          </div>
        </div>
      )}

      {/* Notes list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : notes.length === 0 ? (
        <div className="text-center py-6 text-gray-400">
          <StickyNote className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">لا توجد ملاحظات بعد</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              isAdmin={isAdmin}
              currentUserId={currentUserId}
              onEdit={handleEditNote}
              onDelete={handleDeleteNote}
              onReply={handleAddReply}
              formatDate={formatDate}
              depth={0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Single Note Card with replies ----------
interface NoteCardProps {
  note: ReportNote;
  isAdmin: boolean;
  currentUserId?: string;
  onEdit: (noteId: number, content: string) => Promise<boolean>;
  onDelete: (noteId: number) => void;
  onReply: (parentId: number, content: string) => Promise<boolean>;
  formatDate: (dateStr: string | null) => string;
  depth: number;
}

function NoteCard({
  note,
  isAdmin,
  currentUserId,
  onEdit,
  onDelete,
  onReply,
  formatDate,
  depth,
}: NoteCardProps) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(note.content);
  const [replying, setReplying] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [savingReply, setSavingReply] = useState(false);

  const isAuthor = currentUserId === note.user_id;
  const canEdit = isAuthor;
  const canDelete = isAuthor || isAdmin;
  const canReply = isAdmin;

  const handleSaveEdit = async () => {
    setSavingEdit(true);
    const success = await onEdit(note.id, editContent);
    setSavingEdit(false);
    if (success) {
      setEditing(false);
    }
  };

  const handleSaveReply = async () => {
    setSavingReply(true);
    const success = await onReply(note.id, replyContent);
    setSavingReply(false);
    if (success) {
      setReplying(false);
      setReplyContent('');
    }
  };

  const borderColor = depth === 0 ? 'border-gray-200' : 'border-blue-100';
  const bgColor = depth === 0 ? '' : 'bg-blue-50/30';

  return (
    <div className={depth > 0 ? 'mr-4 border-r-2 border-blue-200 pr-3' : ''}>
      <Card className={`${borderColor} shadow-sm ${bgColor}`}>
        <CardContent className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              {/* Note header */}
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <div className="flex items-center gap-1.5 text-sm font-medium text-blue-700">
                  <User className="h-3.5 w-3.5" />
                  {note.user_name}
                  {note.user_specialization && (
                    <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full font-normal">
                      {note.user_specialization}
                    </span>
                  )}
                </div>
                {note.created_at && (
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <Clock className="h-3 w-3" />
                    {formatDate(note.created_at)}
                  </div>
                )}
                {note.is_edited && (
                  <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded flex items-center gap-1">
                    <Pencil className="h-2.5 w-2.5" />
                    تم التعديل
                    {note.edited_at && (
                      <span className="text-amber-500">
                        {' '}· {formatDate(note.edited_at)}
                      </span>
                    )}
                  </span>
                )}
                {depth > 0 && (
                  <span className="text-xs text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded flex items-center gap-1">
                    <Reply className="h-2.5 w-2.5" />
                    رد
                  </span>
                )}
              </div>

              {/* Note content or edit form */}
              {editing ? (
                <div className="space-y-2">
                  <Textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="min-h-[60px] resize-none text-right text-sm"
                    dir="rtl"
                  />
                  <div className="flex gap-2 justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(false);
                        setEditContent(note.content);
                      }}
                      className="h-7 text-xs"
                    >
                      <X className="h-3 w-3 ml-1" />
                      إلغاء
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveEdit}
                      disabled={savingEdit || !editContent.trim()}
                      className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                    >
                      {savingEdit ? (
                        <span className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full ml-1" />
                      ) : (
                        <Check className="h-3 w-3 ml-1" />
                      )}
                      حفظ
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {note.content}
                </p>
              )}
            </div>

            {/* Action buttons */}
            {!editing && (
              <div className="flex items-center gap-0.5 flex-shrink-0">
                {canReply && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setReplying(!replying)}
                    className="text-blue-400 hover:text-blue-600 hover:bg-blue-50 h-7 w-7 p-0"
                    title="رد"
                  >
                    <Reply className="h-3.5 w-3.5" />
                  </Button>
                )}
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(true);
                      setEditContent(note.content);
                    }}
                    className="text-amber-400 hover:text-amber-600 hover:bg-amber-50 h-7 w-7 p-0"
                    title="تعديل"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
                {canDelete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(note.id)}
                    className="text-red-400 hover:text-red-600 hover:bg-red-50 h-7 w-7 p-0"
                    title="حذف"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Reply form */}
          {replying && (
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
              <Textarea
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder="اكتب ردك هنا..."
                className="min-h-[60px] resize-none text-right text-sm"
                dir="rtl"
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setReplying(false);
                    setReplyContent('');
                  }}
                  className="h-7 text-xs"
                >
                  <X className="h-3 w-3 ml-1" />
                  إلغاء
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveReply}
                  disabled={savingReply || !replyContent.trim()}
                  className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {savingReply ? (
                    <span className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full ml-1" />
                  ) : (
                    <Reply className="h-3 w-3 ml-1" />
                  )}
                  إرسال الرد
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Replies */}
      {note.replies && note.replies.length > 0 && (
        <div className="mt-2 space-y-2">
          {note.replies.map((reply) => (
            <NoteCard
              key={reply.id}
              note={reply}
              isAdmin={isAdmin}
              currentUserId={currentUserId}
              onEdit={onEdit}
              onDelete={onDelete}
              onReply={onReply}
              formatDate={formatDate}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}