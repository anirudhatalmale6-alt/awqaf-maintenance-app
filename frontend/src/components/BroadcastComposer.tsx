import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ArrowRight, Send, Users, Globe, Shield, UserCheck, Search, X, Check } from 'lucide-react';
import { customApi } from '@/lib/customApi';
import { toast } from 'sonner';
import type { BroadcastRole } from '@/lib/types';

interface UserForMessaging {
  id: string;
  name: string;
  role: string;
}

interface BroadcastComposerProps {
  onClose: () => void;
  onSent: () => void;
}

type TargetType = 'all' | 'role' | 'users';

export default function BroadcastComposer({ onClose, onSent }: BroadcastComposerProps) {
  const [step, setStep] = useState<'target' | 'compose'>('target');
  const [targetType, setTargetType] = useState<TargetType>('all');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<{ id: string; name: string }[]>([]);
  const [roles, setRoles] = useState<BroadcastRole[]>([]);
  const [users, setUsers] = useState<UserForMessaging[]>([]);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchRoles();
    fetchUsers();
  }, []);

  const fetchRoles = async () => {
    try {
      const res = await customApi<BroadcastRole[]>('/api/v1/broadcast-messages/roles', 'GET');
      if (Array.isArray(res.data)) {
        setRoles(res.data);
      }
    } catch {
      // ignore
    }
  };

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await customApi<UserForMessaging[]>('/api/v1/messages/users', 'GET');
      if (Array.isArray(res.data)) {
        setUsers(res.data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const toggleRole = (roleValue: string) => {
    setSelectedRoles((prev) =>
      prev.includes(roleValue)
        ? prev.filter((r) => r !== roleValue)
        : [...prev, roleValue]
    );
  };

  const toggleUser = (user: { id: string; name: string }) => {
    setSelectedUsers((prev) =>
      prev.find((u) => u.id === user.id)
        ? prev.filter((u) => u.id !== user.id)
        : [...prev, user]
    );
  };

  const getTargetValue = (): string | undefined => {
    if (targetType === 'all') return undefined;
    if (targetType === 'role') return selectedRoles.join(',');
    if (targetType === 'users') return selectedUsers.map((u) => u.id).join(',');
    return undefined;
  };

  const canProceed = () => {
    if (targetType === 'all') return true;
    if (targetType === 'role') return selectedRoles.length > 0;
    if (targetType === 'users') return selectedUsers.length > 0;
    return false;
  };

  const handleSend = async () => {
    if (!subject.trim() || !content.trim() || sending) return;

    try {
      setSending(true);
      setError('');
      const res = await customApi('/api/v1/broadcast-messages/send', 'POST', {
        subject: subject.trim(),
        content: content.trim(),
        target_type: targetType,
        target_value: getTargetValue(),
      });

      if (res.ok) {
        toast.success('تم الإرسال بنجاح ✅');
        onSent();
      } else {
        setError((res.data as any)?.detail || 'فشل في إرسال الرسالة');
      }
    } catch {
      setError('فشل في إرسال الرسالة');
    } finally {
      setSending(false);
    }
  };

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getTargetSummary = () => {
    if (targetType === 'all') return 'جميع المستخدمين';
    if (targetType === 'role') {
      const roleLabels = selectedRoles.map((rv) => roles.find((r) => r.value === rv)?.label || rv);
      return `الأدوار: ${roleLabels.join('، ')}`;
    }
    if (targetType === 'users') {
      return `${selectedUsers.length} مستخدم(ين) محددين`;
    }
    return '';
  };

  // ---------- Step 1: Target Selection ----------
  const renderTargetSelection = () => (
    <>
      <div className="flex items-center gap-2 p-3 border-b bg-gradient-to-l from-blue-50 to-white">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <ArrowRight className="h-4 w-4" />
        </Button>
        <span className="font-semibold text-gray-900 text-sm">رسالة جماعية - اختر المستلمين</span>
      </div>

      <div className="p-3 space-y-3 max-h-80 overflow-y-auto">
        {/* Target type selection */}
        <div className="space-y-2">
          <button
            onClick={() => setTargetType('all')}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
              targetType === 'all' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <Globe className={`h-5 w-5 ${targetType === 'all' ? 'text-blue-600' : 'text-gray-400'}`} />
            <div className="text-right flex-1">
              <p className={`text-sm font-medium ${targetType === 'all' ? 'text-blue-900' : 'text-gray-700'}`}>
                الجميع
              </p>
              <p className="text-xs text-gray-500">إرسال لجميع المستخدمين</p>
            </div>
            {targetType === 'all' && <Check className="h-4 w-4 text-blue-600" />}
          </button>

          <button
            onClick={() => setTargetType('role')}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
              targetType === 'role' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <Shield className={`h-5 w-5 ${targetType === 'role' ? 'text-blue-600' : 'text-gray-400'}`} />
            <div className="text-right flex-1">
              <p className={`text-sm font-medium ${targetType === 'role' ? 'text-blue-900' : 'text-gray-700'}`}>
                حسب الدور
              </p>
              <p className="text-xs text-gray-500">إرسال لمستخدمين بأدوار محددة</p>
            </div>
            {targetType === 'role' && <Check className="h-4 w-4 text-blue-600" />}
          </button>

          <button
            onClick={() => setTargetType('users')}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
              targetType === 'users' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <UserCheck className={`h-5 w-5 ${targetType === 'users' ? 'text-blue-600' : 'text-gray-400'}`} />
            <div className="text-right flex-1">
              <p className={`text-sm font-medium ${targetType === 'users' ? 'text-blue-900' : 'text-gray-700'}`}>
                مستخدمين محددين
              </p>
              <p className="text-xs text-gray-500">اختيار مستخدمين بالاسم</p>
            </div>
            {targetType === 'users' && <Check className="h-4 w-4 text-blue-600" />}
          </button>
        </div>

        {/* Role selection */}
        {targetType === 'role' && (
          <div className="space-y-1.5 pt-2 border-t">
            <p className="text-xs font-medium text-gray-600 mb-2">اختر الأدوار:</p>
            {roles.map((role) => (
              <button
                key={role.value}
                onClick={() => toggleRole(role.value)}
                className={`w-full flex items-center gap-2 p-2 rounded-lg border transition-colors ${
                  selectedRoles.includes(role.value)
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-gray-100 hover:bg-gray-50'
                }`}
              >
                <div className={`h-4 w-4 rounded border flex items-center justify-center ${
                  selectedRoles.includes(role.value) ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                }`}>
                  {selectedRoles.includes(role.value) && <Check className="h-3 w-3 text-white" />}
                </div>
                <span className="text-sm flex-1 text-right">{role.label}</span>
                <span className="text-xs text-gray-400">{role.user_count} مستخدم</span>
              </button>
            ))}
          </div>
        )}

        {/* User selection */}
        {targetType === 'users' && (
          <div className="space-y-2 pt-2 border-t">
            <div className="relative">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث عن مستخدم..."
                className="text-sm h-8 pr-8"
                dir="rtl"
              />
            </div>

            {selectedUsers.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selectedUsers.map((u) => (
                  <span
                    key={u.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs"
                  >
                    {u.name}
                    <button onClick={() => toggleUser(u)} className="hover:text-blue-900">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="max-h-40 overflow-y-auto space-y-1">
              {loading ? (
                <p className="text-center text-gray-400 text-sm py-4">جاري التحميل...</p>
              ) : filteredUsers.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-4">لا يوجد مستخدمين</p>
              ) : (
                filteredUsers.map((u) => {
                  const isSelected = selectedUsers.some((su) => su.id === u.id);
                  return (
                    <button
                      key={u.id}
                      onClick={() => toggleUser({ id: u.id, name: u.name })}
                      className={`w-full flex items-center gap-2 p-2 rounded-lg border transition-colors ${
                        isSelected ? 'border-blue-400 bg-blue-50' : 'border-gray-100 hover:bg-gray-50'
                      }`}
                    >
                      <div className={`h-4 w-4 rounded border flex items-center justify-center ${
                        isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                      }`}>
                        {isSelected && <Check className="h-3 w-3 text-white" />}
                      </div>
                      <div className="h-6 w-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs flex-shrink-0">
                        {u.name.charAt(0)}
                      </div>
                      <span className="text-sm flex-1 text-right truncate">{u.name}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      <div className="p-3 border-t bg-gray-50">
        <Button
          onClick={() => setStep('compose')}
          disabled={!canProceed()}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white h-9 text-sm"
        >
          التالي - كتابة الرسالة
        </Button>
      </div>
    </>
  );

  // ---------- Step 2: Compose Message ----------
  const renderCompose = () => (
    <>
      <div className="flex items-center gap-2 p-3 border-b bg-gradient-to-l from-blue-50 to-white">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setStep('target')}>
          <ArrowRight className="h-4 w-4" />
        </Button>
        <span className="font-semibold text-gray-900 text-sm">كتابة الرسالة الجماعية</span>
      </div>

      <div className="p-3 space-y-3">
        {/* Target summary */}
        <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-50 border border-blue-200">
          <Users className="h-4 w-4 text-blue-600 flex-shrink-0" />
          <span className="text-xs text-blue-700 flex-1">{getTargetSummary()}</span>
          <button onClick={() => setStep('target')} className="text-xs text-blue-500 hover:text-blue-700">
            تغيير
          </button>
        </div>

        {/* Subject */}
        <div>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="عنوان الرسالة..."
            className="text-sm h-9"
            dir="rtl"
            maxLength={200}
          />
        </div>

        {/* Content */}
        <div>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="محتوى الرسالة..."
            className="text-sm min-h-[120px] resize-none"
            dir="rtl"
          />
        </div>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>
        )}
      </div>

      <div className="p-3 border-t bg-gray-50 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onClose}
          className="flex-1 h-9 text-sm"
        >
          إلغاء
        </Button>
        <Button
          onClick={handleSend}
          disabled={!subject.trim() || !content.trim() || sending}
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white h-9 text-sm gap-1"
        >
          <Send className="h-3.5 w-3.5" />
          {sending ? 'جاري الإرسال...' : 'إرسال'}
        </Button>
      </div>
    </>
  );

  return (
    <div className="flex flex-col h-full">
      {step === 'target' && renderTargetSelection()}
      {step === 'compose' && renderCompose()}
    </div>
  );
}