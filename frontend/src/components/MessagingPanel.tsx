import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowRight, Send, Reply, Users, Search, X, Trash2, Megaphone, Mail, MessageSquare } from 'lucide-react';
import { customApi } from '@/lib/customApi';
import type { Message, Conversation, BroadcastMessage } from '@/lib/types';
import { useAuth } from '@/lib/AuthContext';
import BroadcastComposer from './BroadcastComposer';
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

interface MessagingPanelProps {
  onClose: () => void;
  onUnreadChange: (count: number) => void;
}

interface UserForMessaging {
  id: string;
  name: string;
  role: string;
}

type TabType = 'direct' | 'broadcast';

export default function MessagingPanel({ onClose, onUnreadChange }: MessagingPanelProps) {
  const { user, permissions } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('direct');
  const [view, setView] = useState<'conversations' | 'chat' | 'new' | 'broadcast_compose' | 'broadcast_detail'>('conversations');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [users, setUsers] = useState<UserForMessaging[]>([]);
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string } | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteConvTarget, setDeleteConvTarget] = useState<{ id: string; name: string } | null>(null);
  const [deletingConv, setDeletingConv] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Broadcast state
  const [broadcastMessages, setBroadcastMessages] = useState<BroadcastMessage[]>([]);
  const [broadcastUnread, setBroadcastUnread] = useState(0);
  const [selectedBroadcast, setSelectedBroadcast] = useState<BroadcastMessage | null>(null);
  const [deleteBroadcastTarget, setDeleteBroadcastTarget] = useState<BroadcastMessage | null>(null);
  const [deletingBroadcast, setDeletingBroadcast] = useState(false);

  const canSendBroadcast = permissions?.send_broadcast || user?.role === 'admin' || user?.role === 'owner';
  const isAdminOrOwner = user?.role === 'admin' || user?.role === 'owner';
  const hasDeleteBroadcastPermission = Boolean(
    permissions?.delete_broadcast || isAdminOrOwner
  );

  const canDeleteBroadcast = (msg: BroadcastMessage): boolean => {
    if (!user) return false;
    // Sender can always delete their own broadcast.
    // Admin/owner and users with delete_broadcast permission can delete any broadcast.
    return msg.sender_id === user.id || hasDeleteBroadcastPermission;
  };

  const handleDeleteBroadcast = async () => {
    if (!deleteBroadcastTarget || deletingBroadcast) return;

    try {
      setDeletingBroadcast(true);
      const res = await customApi(`/api/v1/broadcast-messages/delete/${deleteBroadcastTarget.id}`, 'DELETE');
      if (res.ok) {
        const wasUnread = !deleteBroadcastTarget.is_read;
        setBroadcastMessages((prev) => prev.filter((m) => m.id !== deleteBroadcastTarget.id));
        if (selectedBroadcast?.id === deleteBroadcastTarget.id) {
          setSelectedBroadcast(null);
          setView('conversations');
        }
        if (wasUnread) {
          const newUnread = Math.max(0, broadcastUnread - 1);
          setBroadcastUnread(newUnread);
          const directUnread = conversations.reduce((sum, c) => sum + c.unread_count, 0);
          onUnreadChange(directUnread + newUnread);
        }
      }
    } catch {
      // ignore
    } finally {
      setDeletingBroadcast(false);
      setDeleteBroadcastTarget(null);
    }
  };

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    fetchConversations();
    fetchBroadcastInbox();
    // Auto-refresh: poll every 10s while the messaging panel is open so new
    // direct messages and broadcast announcements appear live.
    const interval = setInterval(() => {
      // Silent refresh: avoid flipping loading state to prevent flicker.
      customApi<Conversation[]>('/api/v1/messages/conversations', 'GET')
        .then((res) => {
          const convs = Array.isArray(res.data) ? res.data : [];
          setConversations(convs);
          const totalUnread = convs.reduce((sum, c) => sum + c.unread_count, 0);
          setBroadcastUnread((prevBroadcast) => {
            onUnreadChange(totalUnread + prevBroadcast);
            return prevBroadcast;
          });
        })
        .catch(() => {});
      customApi<{ messages: BroadcastMessage[]; unread_count: number }>(
        '/api/v1/broadcast-messages/inbox',
        'GET',
      )
        .then((res) => {
          if (res.data) {
            setBroadcastMessages(res.data.messages || []);
            setBroadcastUnread(res.data.unread_count || 0);
          }
        })
        .catch(() => {});
    }, 10_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const fetchConversations = async () => {
    try {
      setLoading(true);
      const res = await customApi<Conversation[]>('/api/v1/messages/conversations', 'GET');
      const convs = Array.isArray(res.data) ? res.data : [];
      setConversations(convs);
      const totalUnread = convs.reduce((sum, c) => sum + c.unread_count, 0);
      // Combine with broadcast unread
      onUnreadChange(totalUnread + broadcastUnread);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const fetchBroadcastInbox = async () => {
    try {
      const res = await customApi<{ messages: BroadcastMessage[]; unread_count: number }>('/api/v1/broadcast-messages/inbox', 'GET');
      if (res.data) {
        setBroadcastMessages(res.data.messages || []);
        setBroadcastUnread(res.data.unread_count || 0);
        // Update total unread
        const directUnread = conversations.reduce((sum, c) => sum + c.unread_count, 0);
        onUnreadChange(directUnread + (res.data.unread_count || 0));
      }
    } catch {
      // ignore
    }
  };

  const fetchMessages = async (otherUserId: string) => {
    try {
      setLoading(true);
      const res = await customApi<Message[]>(`/api/v1/messages/conversation/${otherUserId}`, 'GET');
      setMessages(Array.isArray(res.data) ? res.data : []);

      // Mark as read
      await customApi('/api/v1/messages/mark-read', 'POST', { other_user_id: otherUserId });

      // Update unread count
      setConversations((prev) =>
        prev.map((c) => (c.user_id === otherUserId ? { ...c, unread_count: 0 } : c))
      );
      const updatedTotal = conversations.reduce(
        (sum, c) => sum + (c.user_id === otherUserId ? 0 : c.unread_count),
        0
      );
      onUnreadChange(updatedTotal + broadcastUnread);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await customApi<UserForMessaging[]>('/api/v1/messages/users', 'GET');
      setUsers(Array.isArray(res.data) ? res.data : []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const openChat = (userId: string, userName: string) => {
    setSelectedUser({ id: userId, name: userName });
    setView('chat');
    setReplyTo(null);
    fetchMessages(userId);
  };

  const openNewMessage = () => {
    setView('new');
    setSearchQuery('');
    fetchUsers();
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedUser || sending) return;

    try {
      setSending(true);
      const res = await customApi<Message>('/api/v1/messages/send', 'POST', {
        receiver_id: selectedUser.id,
        content: newMessage.trim(),
        parent_id: replyTo?.id || null,
      });

      if (res.data) {
        setMessages((prev) => [...prev, res.data]);
      }
      setNewMessage('');
      setReplyTo(null);
      inputRef.current?.focus();
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  };

  const handleDeleteMessage = async () => {
    if (!deleteTarget || deleting) return;

    try {
      setDeleting(true);
      const res = await customApi(`/api/v1/messages/delete/${deleteTarget.id}`, 'DELETE');
      if (res.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== deleteTarget.id));
        if (replyTo?.id === deleteTarget.id) {
          setReplyTo(null);
        }
      }
    } catch {
      // ignore
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleDeleteConversation = async () => {
    if (!deleteConvTarget || deletingConv) return;

    try {
      setDeletingConv(true);
      const res = await customApi(`/api/v1/messages/conversation/${deleteConvTarget.id}`, 'DELETE');
      if (res.ok) {
        setConversations((prev) => prev.filter((c) => c.user_id !== deleteConvTarget.id));
        if (selectedUser?.id === deleteConvTarget.id) {
          setView('conversations');
          setSelectedUser(null);
          setMessages([]);
          setReplyTo(null);
        }
        const removedConv = conversations.find((c) => c.user_id === deleteConvTarget.id);
        if (removedConv && removedConv.unread_count > 0) {
          const newTotal = conversations.reduce((sum, c) => sum + c.unread_count, 0) - removedConv.unread_count;
          onUnreadChange(Math.max(0, newTotal) + broadcastUnread);
        }
      }
    } catch {
      // ignore
    } finally {
      setDeletingConv(false);
      setDeleteConvTarget(null);
    }
  };

  const handleBroadcastRead = async (broadcast: BroadcastMessage) => {
    setSelectedBroadcast(broadcast);
    setView('broadcast_detail');

    if (!broadcast.is_read) {
      await customApi(`/api/v1/broadcast-messages/mark-read/${broadcast.id}`, 'POST');
      setBroadcastMessages((prev) =>
        prev.map((m) => (m.id === broadcast.id ? { ...m, is_read: true } : m))
      );
      const newUnread = Math.max(0, broadcastUnread - 1);
      setBroadcastUnread(newUnread);
      const directUnread = conversations.reduce((sum, c) => sum + c.unread_count, 0);
      onUnreadChange(directUnread + newUnread);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'الآن';
    if (minutes < 60) return `منذ ${minutes} د`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `منذ ${hours} س`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `منذ ${days} ي`;
    return date.toLocaleDateString('ar-EG-u-ca-gregory-nu-latn');
  };

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.id.includes(searchQuery)
  );

  // ---------- Tab Bar ----------
  const renderTabs = () => (
    <div className="flex border-b bg-white">
      <button
        onClick={() => { setActiveTab('direct'); setView('conversations'); }}
        className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium border-b-2 transition-colors ${
          activeTab === 'direct'
            ? 'border-green-500 text-green-700'
            : 'border-transparent text-gray-500 hover:text-gray-700'
        }`}
      >
        <MessageSquare className="h-3.5 w-3.5" />
        رسائل مباشرة
        {conversations.reduce((sum, c) => sum + c.unread_count, 0) > 0 && (
          <span className="h-4 min-w-[16px] px-1 rounded-full bg-green-500 text-white text-[10px] flex items-center justify-center">
            {conversations.reduce((sum, c) => sum + c.unread_count, 0)}
          </span>
        )}
      </button>
      <button
        onClick={() => { setActiveTab('broadcast'); setView('conversations'); }}
        className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium border-b-2 transition-colors ${
          activeTab === 'broadcast'
            ? 'border-blue-500 text-blue-700'
            : 'border-transparent text-gray-500 hover:text-gray-700'
        }`}
      >
        <Megaphone className="h-3.5 w-3.5" />
        رسائل جماعية
        {broadcastUnread > 0 && (
          <span className="h-4 min-w-[16px] px-1 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center">
            {broadcastUnread}
          </span>
        )}
      </button>
    </div>
  );

  // ---------- Render: Conversations List ----------
  const renderConversations = () => (
    <>
      <div className="flex items-center justify-between p-3 border-b bg-gradient-to-l from-green-50 to-white">
        <h3 className="font-semibold text-gray-900 text-sm">الرسائل المباشرة</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={openNewMessage}
          className="text-green-600 hover:text-green-700 text-xs h-7 gap-1"
        >
          <Users className="h-3.5 w-3.5" />
          رسالة جديدة
        </Button>
      </div>

      <div className="max-h-64 overflow-y-auto">
        {loading ? (
          <div className="p-6 text-center text-gray-500 text-sm">جاري التحميل...</div>
        ) : conversations.length === 0 ? (
          <div className="p-6 text-center">
            <Users className="h-8 w-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">لا توجد محادثات</p>
            <Button
              variant="link"
              size="sm"
              onClick={openNewMessage}
              className="text-green-600 mt-1 text-xs"
            >
              ابدأ محادثة جديدة
            </Button>
          </div>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.user_id}
              className={`relative group w-full text-right p-3 border-b last:border-b-0 hover:bg-gray-50 transition-colors cursor-pointer ${
                conv.unread_count > 0 ? 'bg-green-50/50' : ''
              }`}
              onClick={() => openChat(conv.user_id, conv.user_name)}
            >
              <div className="flex items-start gap-2">
                <div className="mt-0.5 h-8 w-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 text-green-700 font-bold text-sm">
                  {conv.user_name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={`text-sm ${conv.unread_count > 0 ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>
                      {conv.user_name}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-gray-400">
                        {formatTime(conv.last_message_time)}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConvTarget({ id: conv.user_id, name: conv.user_name });
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500 p-0.5 rounded"
                        title="حذف المحادثة"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <p className={`text-xs leading-tight truncate flex-1 ${
                      conv.unread_count > 0 ? 'font-medium text-gray-800' : 'text-gray-500'
                    }`}>
                      {conv.is_sender && <span className="text-gray-400">أنت: </span>}
                      {conv.last_message}
                    </p>
                    {conv.unread_count > 0 && (
                      <span className="h-5 min-w-[20px] px-1 rounded-full bg-green-500 text-white text-[10px] flex items-center justify-center font-bold flex-shrink-0">
                        {conv.unread_count > 9 ? '9+' : conv.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );

  // ---------- Render: Broadcast Inbox ----------
  const renderBroadcastInbox = () => (
    <>
      <div className="flex items-center justify-between p-3 border-b bg-gradient-to-l from-blue-50 to-white">
        <h3 className="font-semibold text-gray-900 text-sm">الرسائل الجماعية</h3>
        {canSendBroadcast && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setView('broadcast_compose')}
            className="text-blue-600 hover:text-blue-700 text-xs h-7 gap-1"
          >
            <Megaphone className="h-3.5 w-3.5" />
            إرسال جماعي
          </Button>
        )}
      </div>

      <div className="max-h-64 overflow-y-auto">
        {broadcastMessages.length === 0 ? (
          <div className="p-6 text-center">
            <Mail className="h-8 w-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">لا توجد رسائل جماعية</p>
          </div>
        ) : (
          broadcastMessages.map((msg) => (
            <div
              key={msg.id}
              onClick={() => handleBroadcastRead(msg)}
              className={`group relative w-full text-right p-3 border-b last:border-b-0 hover:bg-gray-50 transition-colors cursor-pointer ${
                !msg.is_read ? 'bg-blue-50/50' : ''
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="mt-0.5 h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Megaphone className="h-4 w-4 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={`text-sm ${!msg.is_read ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>
                      {msg.subject}
                    </span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-[10px] text-gray-400">
                        {formatTime(msg.created_at)}
                      </span>
                      {canDeleteBroadcast(msg) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteBroadcastTarget(msg);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500 p-0.5 rounded"
                          title="حذف الرسالة الجماعية"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <p className="text-xs text-gray-500 truncate flex-1">
                      من: {msg.sender_name} • {msg.target_label}
                    </p>
                    {!msg.is_read && (
                      <span className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0" />
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );

  // ---------- Render: Broadcast Detail ----------
  const renderBroadcastDetail = () => (
    <>
      <div className="flex items-center gap-2 p-3 border-b bg-gradient-to-l from-blue-50 to-white">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            setView('conversations');
            setSelectedBroadcast(null);
          }}
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Megaphone className="h-4 w-4 text-blue-600" />
        <span className="font-semibold text-gray-900 text-sm truncate flex-1">
          {selectedBroadcast?.subject}
        </span>
        {selectedBroadcast && canDeleteBroadcast(selectedBroadcast) && (
          <button
            onClick={() => setDeleteBroadcastTarget(selectedBroadcast)}
            className="text-gray-400 hover:text-red-500 transition-colors p-1 rounded"
            title="حذف الرسالة الجماعية"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="p-4 space-y-3 max-h-72 overflow-y-auto">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>من: <strong className="text-gray-700">{selectedBroadcast?.sender_name}</strong></span>
          <span>•</span>
          <span>{selectedBroadcast?.target_label}</span>
          <span>•</span>
          <span>{formatTime(selectedBroadcast?.created_at || null)}</span>
        </div>

        <div className="border-t pt-3">
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
            {selectedBroadcast?.content}
          </p>
        </div>
      </div>
    </>
  );

  // ---------- Render: Chat View ----------
  const renderChat = () => (
    <>
      <div className="flex items-center gap-2 p-3 border-b bg-gradient-to-l from-green-50 to-white">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            setView('conversations');
            setSelectedUser(null);
            setReplyTo(null);
            fetchConversations();
          }}
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
        <div className="h-7 w-7 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-xs flex-shrink-0">
          {selectedUser?.name.charAt(0)}
        </div>
        <span className="font-semibold text-gray-900 text-sm truncate flex-1">
          {selectedUser?.name}
        </span>
        <button
          onClick={() => {
            if (selectedUser) {
              setDeleteConvTarget({ id: selectedUser.id, name: selectedUser.name });
            }
          }}
          className="text-gray-400 hover:text-red-500 transition-colors p-1 rounded"
          title="حذف المحادثة"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="h-52 overflow-y-auto p-3 space-y-2 bg-gray-50/50">
        {loading ? (
          <div className="text-center text-gray-400 text-sm py-8">جاري التحميل...</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-8">
            لا توجد رسائل بعد. ابدأ المحادثة!
          </div>
        ) : (
          messages.map((msg) => {
            const isMine = msg.sender_id === user?.id;
            return (
              <div
                key={msg.id}
                className={`flex ${isMine ? 'justify-start' : 'justify-end'}`}
              >
                <div
                  className={`max-w-[80%] rounded-xl px-3 py-2 text-sm relative group ${
                    isMine
                      ? 'bg-green-500 text-white rounded-br-sm'
                      : 'bg-white text-gray-800 border border-gray-200 rounded-bl-sm'
                  }`}
                >
                  {msg.parent_preview && (
                    <div
                      className={`text-[10px] mb-1 pb-1 border-b ${
                        isMine
                          ? 'border-green-400/50 text-green-100'
                          : 'border-gray-200 text-gray-400'
                      }`}
                    >
                      <Reply className="h-2.5 w-2.5 inline ml-1" />
                      {msg.parent_preview}
                    </div>
                  )}
                  <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
                  <div className={`flex items-center justify-between mt-1 gap-2 ${
                    isMine ? 'text-green-100' : 'text-gray-400'
                  }`}>
                    <span className="text-[10px]">{formatTime(msg.created_at)}</span>
                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setReplyTo(msg);
                          inputRef.current?.focus();
                        }}
                        className={`text-[10px] flex items-center gap-0.5 ${
                          isMine ? 'text-green-100 hover:text-white' : 'text-gray-400 hover:text-gray-600'
                        }`}
                      >
                        <Reply className="h-2.5 w-2.5" />
                        رد
                      </button>
                      {isMine && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget(msg);
                          }}
                          className="text-[10px] flex items-center gap-0.5 text-red-200 hover:text-white"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                          حذف
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply indicator */}
      {replyTo && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border-t text-xs text-green-700">
          <Reply className="h-3 w-3 flex-shrink-0" />
          <span className="truncate flex-1">
            رد على: {replyTo.content.slice(0, 50)}
          </span>
          <button onClick={() => setReplyTo(null)} className="text-green-500 hover:text-green-700">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Message input */}
      <div className="flex items-center gap-2 p-2 border-t bg-white">
        <Input
          ref={inputRef}
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="اكتب رسالتك..."
          className="flex-1 text-sm h-9"
          dir="rtl"
        />
        <Button
          size="icon"
          className="h-9 w-9 bg-green-500 hover:bg-green-600 text-white flex-shrink-0"
          onClick={sendMessage}
          disabled={!newMessage.trim() || sending}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </>
  );

  // ---------- Render: New Message (User Selection) ----------
  const renderNewMessage = () => (
    <>
      <div className="flex items-center gap-2 p-3 border-b bg-gradient-to-l from-green-50 to-white">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setView('conversations')}
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
        <span className="font-semibold text-gray-900 text-sm">رسالة جديدة</span>
      </div>

      <div className="p-2 border-b">
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
      </div>

      <div className="max-h-64 overflow-y-auto">
        {loading ? (
          <div className="p-6 text-center text-gray-500 text-sm">جاري التحميل...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">لا يوجد مستخدمين</div>
        ) : (
          filteredUsers.map((u) => (
            <button
              key={u.id}
              onClick={() => openChat(u.id, u.name)}
              className="w-full text-right p-3 border-b last:border-b-0 hover:bg-gray-50 transition-colors flex items-center gap-2"
            >
              <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-sm flex-shrink-0">
                {u.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{u.name}</p>
              </div>
            </button>
          ))
        )}
      </div>
    </>
  );

  // ---------- Render: Broadcast Compose ----------
  const renderBroadcastCompose = () => (
    <BroadcastComposer
      onClose={() => setView('conversations')}
      onSent={() => {
        setView('conversations');
        fetchBroadcastInbox();
      }}
    />
  );

  return (
    <>
      <div
        className="absolute left-0 top-12 w-80 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-50"
        dir="rtl"
      >
        {/* Show tabs only in conversations view */}
        {(view === 'conversations' || view === 'broadcast_detail' || view === 'broadcast_compose') && view !== 'chat' && view !== 'new' && renderTabs()}

        {/* Direct messages views */}
        {activeTab === 'direct' && view === 'conversations' && renderConversations()}
        {activeTab === 'direct' && view === 'chat' && renderChat()}
        {activeTab === 'direct' && view === 'new' && renderNewMessage()}

        {/* Broadcast views */}
        {activeTab === 'broadcast' && view === 'conversations' && renderBroadcastInbox()}
        {activeTab === 'broadcast' && view === 'broadcast_detail' && renderBroadcastDetail()}
        {activeTab === 'broadcast' && view === 'broadcast_compose' && renderBroadcastCompose()}

        {/* Also show chat/new when navigated from broadcast tab but for direct messages */}
        {activeTab === 'broadcast' && view === 'chat' && renderChat()}
        {activeTab === 'broadcast' && view === 'new' && renderNewMessage()}
      </div>

      {/* Delete Message Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد حذف الرسالة</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف هذه الرسالة؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteTarget && (
            <div className="bg-gray-50 rounded-lg p-3 my-2 border border-gray-200">
              <p className="text-sm text-gray-700 line-clamp-3 whitespace-pre-wrap">
                {deleteTarget.content}
              </p>
            </div>
          )}
          <AlertDialogFooter className="flex gap-2 sm:gap-0">
            <AlertDialogCancel disabled={deleting}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDeleteMessage(); }}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? 'جاري الحذف...' : 'حذف الرسالة'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Conversation Confirmation Dialog */}
      <AlertDialog open={!!deleteConvTarget} onOpenChange={(open) => !open && setDeleteConvTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد حذف المحادثة</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف المحادثة بالكامل مع <strong>{deleteConvTarget?.name}</strong>؟ سيتم حذف جميع الرسائل ولا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex gap-2 sm:gap-0">
            <AlertDialogCancel disabled={deletingConv}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDeleteConversation(); }}
              disabled={deletingConv}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deletingConv ? 'جاري الحذف...' : 'حذف المحادثة'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Broadcast Confirmation Dialog */}
      <AlertDialog open={!!deleteBroadcastTarget} onOpenChange={(open) => !open && setDeleteBroadcastTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد حذف الرسالة الجماعية</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف الرسالة الجماعية <strong>"{deleteBroadcastTarget?.subject}"</strong>؟ سيتم حذفها من جميع المستلمين ولا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteBroadcastTarget && (
            <div className="bg-gray-50 rounded-lg p-3 my-2 border border-gray-200">
              <p className="text-sm text-gray-700 line-clamp-3 whitespace-pre-wrap">
                {deleteBroadcastTarget.content}
              </p>
            </div>
          )}
          <AlertDialogFooter className="flex gap-2 sm:gap-0">
            <AlertDialogCancel disabled={deletingBroadcast}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDeleteBroadcast(); }}
              disabled={deletingBroadcast}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deletingBroadcast ? 'جاري الحذف...' : 'حذف الرسالة'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}