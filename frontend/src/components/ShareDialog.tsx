import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Search, User, Check, Tag } from 'lucide-react';
import { customApi } from '@/lib/customApi';
import { toast } from 'sonner';
import type { UserItem } from '@/lib/types';

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportId: number;
  reportTitle: string;
}

export default function ShareDialog({ open, onOpenChange, reportId, reportTitle }: ShareDialogProps) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState<string | null>(null);
  const [sharedUsers, setSharedUsers] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      fetchUsers();
      setSharedUsers(new Set());
      setSearch('');
    }
  }, [open]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await customApi<UserItem[]>('/api/v1/reports-custom/users-list', 'GET');
      setUsers(Array.isArray(response.data) ? response.data : []);
    } catch {
      toast.error('فشل في تحميل المستخدمين');
    } finally {
      setLoading(false);
    }
  };

  const shareWithUser = async (userId: string) => {
    try {
      setSharing(userId);
      await customApi('/api/v1/reports-custom/share', 'POST', {
        report_id: reportId,
        recipient_id: userId,
      });
      setSharedUsers((prev) => new Set(prev).add(userId));
      toast.success('تمت المشاركة بنجاح');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'فشل في المشاركة';
      toast.error(msg);
    } finally {
      setSharing(null);
    }
  };

  const filteredUsers = users.filter(
    (u) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        (u.name && (u.name.includes(search.trim()) || u.name.toLowerCase().includes(q))) ||
        (u.phone && u.phone.includes(search.trim())) ||
        (u.member_tag && (u.member_tag.includes(search.trim()) || u.member_tag.toLowerCase().includes(q)))
      );
    }
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>مشاركة البلاغ</DialogTitle>
          <DialogDescription>
            مشاركة &quot;{reportTitle}&quot; مع مستخدمين آخرين
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="بحث بالاسم أو رقم الهاتف..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9"
          />
        </div>

        <div className="max-h-64 overflow-y-auto space-y-1">
          {loading ? (
            <div className="p-4 text-center text-gray-500">جاري التحميل...</div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              {users.length === 0 ? 'لا يوجد مستخدمين آخرين' : 'لا توجد نتائج'}
            </div>
          ) : (
            filteredUsers.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-blue-100 flex items-center justify-center">
                    <User className="h-4 w-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {user.name || 'مستخدم'}
                    </p>
                    {user.phone && (
                      <p className="text-xs text-gray-500" dir="ltr">{user.phone}</p>
                    )}
                    {user.member_tag && (
                      <p className="text-xs text-teal-600 flex items-center gap-1 mt-0.5">
                        <Tag className="h-3 w-3" />
                        {user.member_tag}
                      </p>
                    )}
                  </div>
                </div>

                {sharedUsers.has(user.id) ? (
                  <Button variant="ghost" size="sm" disabled className="text-green-600">
                    <Check className="h-4 w-4 ml-1" />
                    تمت المشاركة
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => shareWithUser(user.id)}
                    disabled={sharing === user.id}
                  >
                    {sharing === user.id ? (
                      <span className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full" />
                    ) : (
                      <>
                        <Send className="h-3.5 w-3.5 ml-1" />
                        مشاركة
                      </>
                    )}
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}