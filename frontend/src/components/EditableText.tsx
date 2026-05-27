import { useState, useRef, useEffect } from 'react';
import { useCustomTexts } from '@/lib/CustomTextsContext';
import { Pencil, Check, X, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

interface EditableTextProps {
  /** Unique key for this text element */
  textKey: string;
  /** Default text to show if no custom text is set */
  defaultText: string;
  /** HTML tag to render: h1, h2, h3, p, span, label, button */
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'span' | 'label' | 'button' | 'div';
  /** Additional CSS classes */
  className?: string;
  /** Whether to use a textarea for multiline editing */
  multiline?: boolean;
}

export default function EditableText({
  textKey,
  defaultText,
  as: Tag = 'span',
  className = '',
  multiline = false,
}: EditableTextProps) {
  const { getText, setText, deleteText, isOwner } = useCustomTexts();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  const currentText = getText(textKey, defaultText);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEditing = () => {
    if (!isOwner) return;
    setEditValue(currentText);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditValue('');
  };

  const saveText = async () => {
    const trimmed = editValue.trim();
    if (!trimmed) {
      toast.error('النص لا يمكن أن يكون فارغاً');
      return;
    }
    if (trimmed === currentText) {
      setEditing(false);
      return;
    }
    try {
      setSaving(true);
      await setText(textKey, trimmed);
      toast.success('تم حفظ النص بنجاح');
      setEditing(false);
    } catch {
      toast.error('فشل في حفظ النص');
    } finally {
      setSaving(false);
    }
  };

  const revertToDefault = async () => {
    if (currentText === defaultText) {
      toast.info('النص هو النص الافتراضي بالفعل');
      return;
    }
    try {
      setSaving(true);
      await deleteText(textKey);
      toast.success('تم إعادة النص للافتراضي');
      setEditing(false);
    } catch {
      toast.error('فشل في إعادة النص للافتراضي');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault();
      saveText();
    }
    if (e.key === 'Escape') {
      cancelEditing();
    }
  };

  // Non-owner: just render the text
  if (!isOwner) {
    return <Tag className={className}>{currentText}</Tag>;
  }

  // Owner in editing mode
  if (editing) {
    return (
      <div className="inline-flex flex-col gap-1 w-full">
        <div className="flex items-center gap-1 w-full">
          {multiline ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 px-2 py-1 border-2 border-blue-400 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y min-h-[60px]"
              disabled={saving}
              dir="rtl"
              rows={3}
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 px-2 py-1 border-2 border-blue-400 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={saving}
              dir="rtl"
            />
          )}
          <button
            onClick={saveText}
            disabled={saving}
            className="p-1.5 rounded-md bg-green-500 text-white hover:bg-green-600 transition-colors disabled:opacity-50"
            title="حفظ"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={cancelEditing}
            disabled={saving}
            className="p-1.5 rounded-md bg-gray-400 text-white hover:bg-gray-500 transition-colors disabled:opacity-50"
            title="إلغاء"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {currentText !== defaultText && (
            <button
              onClick={revertToDefault}
              disabled={saving}
              className="p-1.5 rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50"
              title="إعادة للافتراضي"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <span className="text-[10px] text-gray-400">الافتراضي: {defaultText}</span>
      </div>
    );
  }

  // Owner not editing: show text with edit icon on hover
  return (
    <span
      className={`group relative inline-flex items-center gap-1 cursor-pointer ${className}`}
      onClick={startEditing}
      title="انقر للتعديل"
    >
      <Tag className="">{currentText}</Tag>
      <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 inline-flex items-center">
        <Pencil className="h-3.5 w-3.5 text-blue-500" />
      </span>
    </span>
  );
}