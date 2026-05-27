import * as React from 'react';
import { ChevronsUpDown, Search, UserCheck, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export interface EngineerOption {
  id: string;
  name: string;
  specialization?: string;
}

interface EngineerMultiSelectorProps {
  engineers: EngineerOption[];
  /** Selected engineer names (matching EngineerOption.name) */
  value: string[];
  onChange: (names: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A searchable multi-select engineer picker.
 * Selected engineers are stored as their display names so they stay readable
 * even if a user is later removed.
 */
export function EngineerMultiSelector({
  engineers,
  value,
  onChange,
  placeholder = 'اختر المهندسين',
  disabled = false,
  className,
}: EngineerMultiSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const safeEngineers = React.useMemo(
    () =>
      (Array.isArray(engineers) ? engineers : [])
        .filter((e) => e && typeof e === 'object' && e.name)
        .map((e) => ({
          id: String(e.id ?? e.name),
          name: String(e.name),
          specialization: e.specialization ? String(e.specialization) : undefined,
        })),
    [engineers],
  );

  const filtered = React.useMemo(() => {
    if (!search.trim()) return safeEngineers;
    const q = search.trim().toLowerCase();
    return safeEngineers.filter(
      (e) =>
        (e.name || '').toLowerCase().includes(q) ||
        (e.specialization || '').toLowerCase().includes(q)
    );
  }, [safeEngineers, search]);

  const toggle = (name: string) => {
    const exists = value.includes(name);
    if (exists) {
      onChange(value.filter((n) => n !== name));
    } else {
      onChange([...value, name]);
    }
  };

  const removeOne = (name: string) => {
    onChange(value.filter((n) => n !== name));
  };

  return (
    <div className={cn('w-full', className)}>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setSearch('');
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between gap-2 font-normal bg-white"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <UserCheck className="h-4 w-4 text-gray-400 shrink-0" />
              <span
                className={cn(
                  'truncate text-right',
                  value.length === 0 && 'text-gray-500'
                )}
              >
                {value.length === 0
                  ? placeholder
                  : `${value.length} مهندس مختار`}
              </span>
            </div>
            <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <Input
                placeholder="ابحث بالاسم أو التخصص..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pr-8 text-sm"
                autoFocus
                dir="rtl"
              />
            </div>
          </div>
          <div className="max-h-[280px] overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-gray-500">
                لا توجد نتائج
              </div>
            ) : (
              filtered.map((e) => {
                const checked = value.includes(e.name);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => toggle(e.name)}
                    className={cn(
                      'w-full text-right flex items-start gap-2 px-2 py-1.5 rounded-md text-sm transition-colors hover:bg-gray-100',
                      checked && 'bg-blue-50 hover:bg-blue-100'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      readOnly
                      className="mt-0.5 accent-blue-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{e.name}</div>
                      {e.specialization && (
                        <div className="text-xs text-gray-500 truncate">
                          {e.specialization}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
          {value.length > 0 && (
            <div className="p-2 border-t flex items-center justify-between">
              <span className="text-xs text-gray-500">
                {value.length} مختار
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-red-600 hover:text-red-700"
                onClick={() => onChange([])}
              >
                مسح الكل
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.map((name) => (
            <Badge
              key={name}
              variant="secondary"
              className="gap-1 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200"
            >
              <span className="truncate max-w-[140px]">{name}</span>
              <button
                type="button"
                onClick={() => removeOne(name)}
                className="hover:bg-blue-200 rounded-sm p-0.5 transition-colors"
                aria-label={`إزالة ${name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}