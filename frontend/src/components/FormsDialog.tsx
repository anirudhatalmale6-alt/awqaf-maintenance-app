import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileText, ArrowRight, Printer, ExternalLink } from 'lucide-react';

interface FormTemplate {
  id: string;
  title: string;
  description: string;
  file: string;
  color: string;
}

const FORM_TEMPLATES: FormTemplate[] = [
  {
    id: 'maintenance-report',
    title: 'نموذج بلاغات الصيانة السريعة',
    description: 'نموذج لتنفيذ أعمال الصيانة السريعة مع تحديد المدة والغرامة',
    file: '/forms/maintenance-report.html?v=5',
    color: 'bg-blue-50 border-blue-200 hover:bg-blue-100 text-blue-800',
  },
  {
    id: 'site-instructions',
    title: 'نموذج التعليمات الموقعية',
    description: 'نموذج لإصدار تعليمات موقعية للمقاول في موقع العمل',
    file: '/forms/site-instructions.html?v=5',
    color: 'bg-amber-50 border-amber-200 hover:bg-amber-100 text-amber-800',
  },
  {
    id: 'technical-report',
    title: 'نموذج تقرير فني',
    description: 'نموذج لإعداد تقرير فني شامل عن الأعمال المنفذة',
    file: '/forms/technical-report.html?v=5',
    color: 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100 text-emerald-800',
  },
  {
    id: 'site-replacement',
    title: 'نموذج زيارات ميدانية لاستلام مواقع',
    description: 'نموذج زيارات ميدانية لاستلام المواقع الخاصة بالمشاريع (بدل موقع)',
    file: '/forms/بدل-موقع.html?v=7',
    color: 'bg-purple-50 border-purple-200 hover:bg-purple-100 text-purple-800',
  },
];

interface FormsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportId?: number;
  onAttachmentAdded?: () => void;
}

export default function FormsDialog({ open, onOpenChange }: FormsDialogProps) {
  const [selectedForm, setSelectedForm] = useState<FormTemplate | null>(null);

  useEffect(() => {
    if (!open) {
      setSelectedForm(null);
    }
  }, [open]);

  const handleOpenInNewTab = () => {
    if (!selectedForm) return;
    window.open(selectedForm.file, '_blank', 'noopener,noreferrer');
  };

  const handlePrint = () => {
    const iframe = document.getElementById('form-preview-iframe') as HTMLIFrameElement | null;
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch {
        // Fallback: open in new tab so user can print from there
        if (selectedForm) {
          window.open(selectedForm.file, '_blank', 'noopener,noreferrer');
        }
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // max-h-[95dvh] uses dynamic viewport height (handles mobile address bar
        // collapse/expand correctly). The grid view scrolls internally via
        // overflow-y-auto on the picker container; the iframe-preview view
        // continues to use overflow-hidden + flex layout (handled below per branch).
        className="max-w-5xl w-[95vw] max-h-[95vh] max-h-[95dvh] flex flex-col p-4 sm:p-6"
        dir="rtl"
      >
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="text-xl flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            {selectedForm ? selectedForm.title : 'النماذج الرسمية'}
          </DialogTitle>
          <DialogDescription>
            {selectedForm
              ? 'املأ الحقول المطلوبة ثم اضغط على زر الطباعة لطباعة النموذج'
              : 'اختر نموذجاً لعرضه وطباعته'}
          </DialogDescription>
        </DialogHeader>

        {!selectedForm ? (
          // overflow-y-auto + overscroll-contain + -webkit-overflow-scrolling:touch
          // ensures all 4 form cards are reachable on mobile (where the grid is
          // single-column and exceeds viewport height). flex-1 + min-h-0 makes
          // the scrollable area fill the remaining dialog space below the header.
          <div
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-4">
              {FORM_TEMPLATES.map((form) => (
                <button
                  key={form.id}
                  type="button"
                  onClick={() => setSelectedForm(form)}
                  className={`${form.color} border-2 rounded-xl p-6 text-right transition-all hover:shadow-lg hover:-translate-y-0.5 flex flex-col gap-3 min-h-[180px]`}
                >
                  <div className="flex items-center justify-between">
                    <FileText className="h-10 w-10" />
                    <span className="text-xs font-bold bg-white/60 px-2 py-1 rounded">
                      HTML
                    </span>
                  </div>
                  <div>
                    <h3 className="text-base font-bold mb-2">{form.title}</h3>
                    <p className="text-xs opacity-80 leading-relaxed">
                      {form.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex items-center justify-between gap-2 pb-3 border-b flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedForm(null)}
              >
                <ArrowRight className="h-4 w-4 ml-1" />
                اختيار نموذج آخر
              </Button>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenInNewTab}
                  className="text-gray-700 hover:text-gray-900 hover:bg-gray-50"
                >
                  <ExternalLink className="h-4 w-4 ml-1" />
                  فتح في تبويب جديد
                </Button>
                <Button
                  size="sm"
                  onClick={handlePrint}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  <Printer className="h-4 w-4 ml-1" />
                  طباعة
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden mt-3 bg-gray-100 rounded-lg">
              <iframe
                id="form-preview-iframe"
                src={selectedForm.file}
                className="w-full h-full border-0 bg-white rounded-lg"
                title={selectedForm.title}
                style={{ minHeight: '600px' }}
              />
            </div>

            <p className="text-xs text-gray-500 text-center pt-2">
              💡 املأ الحقول داخل النموذج أعلاه ثم اضغط "طباعة" لطباعته، أو افتحه في تبويب جديد للعمل عليه بحجم كامل
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}