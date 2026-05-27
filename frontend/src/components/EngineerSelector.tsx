import * as React from 'react';
import { Check, ChevronsUpDown, Search, UserCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

interface EngineerSelectorProps {
  engineers: EngineerOption[];
  value?: string; // selected engineer id, or 'none' or ''
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** If true, include a "بدون تعيين" (none) option at the top */
  includeNone?: boolean;
  /** Trigger button width classes */
  triggerClassName?: string;
  /** Show the selected value as a plain label in the trigger */
  triggerVariant?: 'outline' | 'bulk';
}

/**
 * A searchable engineer selector that displays engineer name with specialization shown beneath.
 * Supports both single-report assignment (with "none") and bulk assignment (without "none").
 */
export function EngineerSelector({
  engineers,
  value,
  onValueChange,
  placeholder = 'اختر المهندس',
  disabled = false,
  className,
  includeNone = false,
  triggerClassName,
  triggerVariant = 'outline',
}: EngineerSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const filtered = React.useMemo(() => {
    if (!search.trim()) return engineers;
    const q = search.trim().toLowerCase();
    return engineers.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.specialization || '').toLowerCase().includes(q)
    );
  }, [engineers, search]);

  const selected = value && value !== 'none' ? engineers.find((e) => e.id === value) : undefined;

  const triggerLabel = selected
    ? selected.name
    : value === 'none'
      ? 'بدون تعيين'
      : placeholder;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(''); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'justify-between gap-2 font-normal',
            triggerVariant === 'bulk' ? 'bg-white border-purple-200' : 'bg-white',
            triggerClassName,
            className
          )}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <UserCheck className="h-4 w-4 text-gray-400 shrink-0" />
            <span className={cn('truncate text-right', !selected && value !== 'none' && 'text-gray-500')}>
              {triggerLabel}
            </span>
          </div>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
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
          {includeNone && (
            <button
              type="button"
              onClick={() => {
                onValueChange('none');
                setOpen(false);
                setSearch('');
              }}
              className={cn(
                'w-full text-right flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
                'hover:bg-gray-100',
                value === 'none' && 'bg-gray-50'
              )}
            >
              <Check className={cn('h-4 w-4 shrink-0', value === 'none' ? 'opacity-100' : 'opacity-0')} />
              <span className="text-gray-500 italic">— بدون تعيين —</span>
            </button>
          )}
          {filtered.length === 0 ? (
            <div className="text-center py-6 text-sm text-gray-400">
              لا يوجد مهندس مطابق للبحث
            </div>
          ) : (
            filtered.map((eng) => {
              const isSelected = value === eng.id;
              return (
                <button
                  key={eng.id}
                  type="button"
                  onClick={() => {
                    onValueChange(eng.id);
                    setOpen(false);
                    setSearch('');
                  }}
                  className={cn(
                    'w-full text-right flex items-start gap-2 px-2 py-2 rounded-md transition-colors',
                    'hover:bg-blue-50',
                    isSelected && 'bg-blue-50'
                  )}
                >
                  <Check
                    className={cn(
                      'h-4 w-4 mt-0.5 shrink-0 text-blue-600',
                      isSelected ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <div className="flex flex-col items-start min-w-0 flex-1">
                    <span className="text-sm font-medium text-gray-900 truncate w-full text-right">
                      {eng.name}
                    </span>
                    {eng.specialization && (
                      <span className="text-xs text-gray-500 truncate w-full text-right mt-0.5">
                        {eng.specialization}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}