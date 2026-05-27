import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Users, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { getRoleLabel } from "@/lib/roleLabels";

export interface PickerUser {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
}

interface Props {
  users: PickerUser[];
  loading?: boolean;
  selectedUserIds: string[];
  onChange: (next: { userIds: string[] }) => void;
  /** Compact label for the trigger button. */
  triggerLabel?: string;
  disabled?: boolean;
}

/**
 * Searchable picker for choosing notification recipients (specific users only).
 *
 * Note: A previous version of this component also supported selecting whole
 * roles. That capability was intentionally removed — notifications must now
 * be addressed to individual users by name. The role badge next to each user
 * is purely informational.
 */
export default function NotificationTargetsPicker({
  users,
  loading,
  selectedUserIds,
  onChange,
  triggerLabel = "اختيار المستلمين",
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filteredUsers = useMemo(() => {
    if (!query.trim()) return users;
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      // Match against name, email, raw role key, AND the localized Arabic role
      // label so users can search by either "engineer" or "مهندس".
      return (
        (u.name || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q) ||
        (u.role || "").toLowerCase().includes(q) ||
        getRoleLabel(u.role).toLowerCase().includes(q)
      );
    });
  }, [users, query]);

  const toggleUser = (id: string) => {
    const next = selectedUserIds.includes(id)
      ? selectedUserIds.filter((x) => x !== id)
      : [...selectedUserIds, id];
    onChange({ userIds: next });
  };

  const clearAll = () => {
    onChange({ userIds: [] });
  };

  const totalSelected = selectedUserIds.length;

  const userById = useMemo(() => {
    const m = new Map<string, PickerUser>();
    users.forEach((u) => m.set(u.id, u));
    return m;
  }, [users]);

  return (
    <div className="space-y-2" dir="rtl">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-between font-normal",
              totalSelected > 0 &&
                "border-blue-300 bg-blue-50/50 dark:bg-blue-950/30",
            )}
          >
            <span className="flex items-center gap-2 truncate">
              <Users className="w-4 h-4 shrink-0" />
              {totalSelected === 0 ? (
                <span className="text-muted-foreground">{triggerLabel}</span>
              ) : (
                <span className="truncate">
                  تم اختيار {totalSelected}{" "}
                  {totalSelected === 1 ? "مستخدم" : "مستخدمين"}
                </span>
              )}
            </span>
            <ChevronsUpDown className="w-4 h-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[--radix-popover-trigger-width] p-0"
          dir="rtl"
        >
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="بحث بالاسم أو البريد أو الدور..."
                className="pr-8 h-9"
              />
            </div>
          </div>

          <ScrollArea className="max-h-72">
            {/* Users list */}
            <div className="p-2">
              <div className="text-[11px] font-semibold text-muted-foreground px-1 pb-1">
                المستخدمون{" "}
                {filteredUsers.length > 0 && (
                  <span className="text-muted-foreground/70">
                    ({filteredUsers.length})
                  </span>
                )}
              </div>
              {loading ? (
                <div className="text-xs text-muted-foreground p-3 text-center">
                  جارٍ التحميل...
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="text-xs text-muted-foreground p-3 text-center">
                  لا توجد نتائج
                </div>
              ) : (
                <div className="space-y-0.5">
                  {filteredUsers.map((u) => {
                    const checked = selectedUserIds.includes(u.id);
                    const roleLabel = getRoleLabel(u.role);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => toggleUser(u.id)}
                        className={cn(
                          "w-full flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent text-right",
                          checked && "bg-blue-50 dark:bg-blue-950/40",
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          className="pointer-events-none"
                        />
                        <div className="flex-1 min-w-0 text-right">
                          <div className="truncate font-medium">
                            {u.name || u.email || u.id}
                          </div>
                          {u.email && u.name && (
                            <div className="truncate text-[11px] text-muted-foreground">
                              {u.email}
                            </div>
                          )}
                        </div>
                        {roleLabel && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0 shrink-0 bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300"
                          >
                            {roleLabel}
                          </Badge>
                        )}
                        {checked && <Check className="w-4 h-4 text-blue-600" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="flex items-center justify-between p-2 border-t bg-muted/40">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={clearAll}
              disabled={totalSelected === 0}
              className="h-7 text-xs"
            >
              مسح الكل
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setOpen(false)}
              className="h-7 text-xs"
            >
              تم
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Selected chips — users only */}
      {totalSelected > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedUserIds.map((id) => {
            const u = userById.get(id);
            const roleLabel = getRoleLabel(u?.role);
            return (
              <Badge
                key={`user-${id}`}
                variant="secondary"
                className="gap-1 pr-1.5"
              >
                <span>{u?.name || u?.email || id}</span>
                {roleLabel && (
                  <span className="text-[10px] text-muted-foreground/80">
                    ({roleLabel})
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => toggleUser(id)}
                  className="hover:bg-muted rounded p-0.5"
                  aria-label="إزالة"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}