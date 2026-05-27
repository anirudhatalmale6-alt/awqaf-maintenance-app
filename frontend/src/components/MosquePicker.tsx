/**
 * MosquePicker — Searchable mosque selector grouped by region.
 *
 * Props:
 *   - value: selected mosque id (number | null)
 *   - onChange: callback receiving { id, name } | null
 *   - placeholder: button placeholder when empty
 *   - allowClear: show "— بدون —" clear option (default true)
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Check, ChevronsUpDown, MapPin, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { customApi } from '@/lib/customApi';

interface MosqueItem {
  id: number;
  name: string;
}

interface RegionWithMosques {
  id: number;
  name: string;
  mosques: MosqueItem[];
}

interface MosquePickerProps {
  value: number | null;
  onChange: (mosque: { id: number; name: string } | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  className?: string;
}

function useRegionsWithMosques() {
  return useQuery<RegionWithMosques[]>({
    queryKey: ['regions-with-mosques'],
    queryFn: async () => {
      const res = await customApi<RegionWithMosques[]>(
        '/api/v1/locations/regions-with-mosques',
        'GET',
      );
      return res.data || [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export default function MosquePicker({
  value,
  onChange,
  placeholder = 'اختر مسجداً',
  allowClear = true,
  className,
}: MosquePickerProps) {
  const [open, setOpen] = useState(false);
  const { data: regions = [], isLoading } = useRegionsWithMosques();

  const selectedName = useMemo(() => {
    if (!value) return null;
    for (const r of regions) {
      const found = r.mosques.find((m) => m.id === value);
      if (found) return found.name;
    }
    return null;
  }, [value, regions]);

  // Filter out empty regions
  const visibleRegions = useMemo(
    () => regions.filter((r) => r.mosques && r.mosques.length > 0),
    [regions],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'w-full justify-between font-normal',
            !selectedName && 'text-muted-foreground',
            className,
          )}
        >
          <span className="flex items-center gap-2 truncate">
            <MapPin className="h-4 w-4 shrink-0 text-blue-600" />
            <span className="truncate">{selectedName || placeholder}</span>
          </span>
          <span className="flex items-center gap-1 shrink-0">
            {allowClear && value && (
              <span
                role="button"
                tabIndex={0}
                aria-label="مسح"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onChange(null);
                  }
                }}
                className="rounded hover:bg-muted p-0.5 cursor-pointer"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] min-w-[280px] p-0"
        align="start"
      >
        <Command
          filter={(val, search) => {
            // val is "regionName|mosqueName" we set below; do case-insensitive includes
            if (!search) return 1;
            const v = val.toLowerCase();
            const s = search.toLowerCase().trim();
            return v.includes(s) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="ابحث عن مسجد أو منطقة..." />
          <CommandList className="max-h-[320px]">
            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                جاري التحميل...
              </div>
            ) : (
              <>
                <CommandEmpty>لا توجد نتائج مطابقة</CommandEmpty>
                {allowClear && (
                  <CommandGroup>
                    <CommandItem
                      value="__clear__ بدون"
                      onSelect={() => {
                        onChange(null);
                        setOpen(false);
                      }}
                    >
                      <span className="text-muted-foreground">— بدون —</span>
                    </CommandItem>
                  </CommandGroup>
                )}
                {visibleRegions.map((region) => (
                  <CommandGroup
                    key={region.id}
                    heading={region.name}
                    className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-blue-600"
                  >
                    {region.mosques.map((m) => {
                      const isSelected = value === m.id;
                      return (
                        <CommandItem
                          key={m.id}
                          value={`${region.name} ${m.name}`}
                          onSelect={() => {
                            onChange({ id: m.id, name: m.name });
                            setOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              'ml-2 h-4 w-4',
                              isSelected ? 'opacity-100' : 'opacity-0',
                            )}
                          />
                          <span className="truncate">{m.name}</span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}