import { useState } from 'react';
import { X, ExternalLink, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AttachmentItem {
  id: string;
  file_name: string;
  url: string;
  isPdf: boolean;
}

interface AttachmentPreviewProps {
  attachments: AttachmentItem[];
  initialIndex: number;
  onClose: () => void;
}

export default function AttachmentPreview({ attachments, initialIndex, onClose }: AttachmentPreviewProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const current = attachments[currentIndex];

  if (!current) return null;

  const goNext = () => {
    if (currentIndex < attachments.length - 1) setCurrentIndex(currentIndex + 1);
  };

  const goPrev = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex flex-col items-center justify-center"
      onClick={onClose}
    >
      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-black/60 text-white z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate max-w-[200px] sm:max-w-[400px]">
            {current.file_name}
          </span>
          <span className="text-xs text-gray-300">
            ({currentIndex + 1} / {attachments.length})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-white hover:bg-white/20"
            onClick={() => window.open(current.url, '_blank')}
            title="فتح في تبويب جديد"
          >
            <ExternalLink className="h-4 w-4 ml-1" />
            <span className="hidden sm:inline text-xs">تبويب جديد</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20"
            onClick={onClose}
            title="إغلاق"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Content area */}
      <div
        className="flex-1 w-full flex items-center justify-center px-4 pt-14 pb-4 overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {current.isPdf ? (
          <iframe
            src={current.url}
            className="w-full max-w-4xl h-[80vh] rounded-lg border-0 bg-white"
            title={current.file_name}
          />
        ) : (
          <img
            src={current.url}
            alt={current.file_name}
            className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
          />
        )}
      </div>

      {/* Navigation arrows */}
      {attachments.length > 1 && (
        <>
          <button
            className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/40 text-white rounded-full p-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            disabled={currentIndex >= attachments.length - 1}
            title="التالي"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
          <button
            className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/40 text-white rounded-full p-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            disabled={currentIndex <= 0}
            title="السابق"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        </>
      )}
    </div>
  );
}