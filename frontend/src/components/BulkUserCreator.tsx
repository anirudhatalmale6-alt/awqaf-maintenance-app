import { useState } from 'react';
import { customApi } from '@/lib/customApi';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Users, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

interface RoleOption {
  value: string;
  label: string;
}

interface BulkUserCreatorProps {
  roleOptions: RoleOption[];
  onCreated: () => void;
}

interface BulkResult {
  created_count: number;
  error_count: number;
  created: { name: string; role: string }[];
  errors: { index: number; name: string; error: string }[];
}

export default function BulkUserCreator({ roleOptions, onCreated }: BulkUserCreatorProps) {
  const [open, setOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [defaultRole, setDefaultRole] = useState('user');
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);

  const handleBulkCreate = async () => {
    const lines = bulkText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      toast.error('يرجى إدخال أسماء المستخدمين');
      return;
    }

    if (lines.length > 50) {
      toast.error('الحد الأقصى 50 حساب في المرة الواحدة');
      return;
    }

    const users = lines.map((line) => {
      // Support format: name | phone | role  OR  name | phone  OR  name
      const parts = line.split('|').map((p) => p.trim());
      const name = parts[0] || '';
      const phone = parts[1] || undefined;
      const role = parts[2] || defaultRole;
      return { name, phone, role };
    });

    setCreating(true);
    setResult(null);
    try {
      const res = await customApi<BulkResult>(
        '/api/v1/admin/users/bulk-create',
        'POST',
        { users },
      );
      const data = res.data;
      setResult(data);
      if (data.created_count > 0) {
        toast.success(`تم إنشاء ${data.created_count} حساب بنجاح`);
        onCreated();
      }
      if (data.error_count > 0) {
        toast.warning(`${data.error_count} حساب لم يتم إنشاؤه`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل في إنشاء الحسابات';
      toast.error(message);
    } finally {
      setCreating(false);
    }
  };

  const handleClose = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setBulkText('');
      setResult(null);
      setDefaultRole('user');
    }
  };

  const parsedCount = bulkText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button variant="outline" className="border-purple-300 text-purple-700 hover:bg-purple-50">
          <Users className="h-4 w-4 ml-1" />
          إنشاء حسابات متعددة
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>إنشاء حسابات متعددة</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label>الصلاحية الافتراضية</Label>
            <Select value={defaultRole} onValueChange={setDefaultRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions
                  .filter((r) => r.value !== 'disabled')
                  .map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>أسماء المستخدمين (سطر لكل مستخدم)</Label>
            <div className="text-xs text-gray-500 space-y-1">
              <p>أدخل اسم مستخدم واحد في كل سطر.</p>
              <p>يمكنك إضافة رقم الهاتف والصلاحية بفصلها بـ | :</p>
              <p className="font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-[11px]" dir="ltr">
                اسم المستخدم | رقم الهاتف | الصلاحية
              </p>
            </div>
            <Textarea
              placeholder={`محمد أحمد\nعلي سعيد | 0512345678\nخالد عمر | 0598765432 | admin`}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={8}
              className="font-mono text-sm"
              dir="rtl"
            />
            {parsedCount > 0 && (
              <p className="text-xs text-gray-500">
                سيتم إنشاء <span className="font-bold text-purple-600">{parsedCount}</span> حساب
              </p>
            )}
          </div>

          {result && (
            <div className="space-y-2 border rounded-lg p-3 bg-gray-50 dark:bg-gray-800">
              {result.created_count > 0 && (
                <div className="flex items-center gap-2 text-green-600 text-sm">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>تم إنشاء {result.created_count} حساب بنجاح</span>
                </div>
              )}
              {result.errors.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-amber-600 text-sm">
                    <AlertTriangle className="h-4 w-4" />
                    <span>أخطاء ({result.errors.length}):</span>
                  </div>
                  <ul className="text-xs text-red-600 space-y-1 mr-6">
                    {result.errors.map((err, i) => (
                      <li key={i}>
                        <span className="font-medium">{err.name || `سطر ${err.index + 1}`}</span>: {err.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <Button
            onClick={handleBulkCreate}
            disabled={creating || parsedCount === 0}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white"
          >
            {creating ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                جاري الإنشاء...
              </span>
            ) : (
              `إنشاء ${parsedCount} حساب`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}