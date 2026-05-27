import { useMemo, useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2, PlusCircle, Search } from 'lucide-react';

export interface BulkReportRow {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  reporter_name: string;
  reporter_phone: string;
  region: string;
  mosque_name: string;
  assigned_engineer_name: string;
  executing_entity: string;
  date_mode: 'today' | 'custom';
  custom_date: string;
}

interface Option {
  value: string;
  label: string;
}

interface RegionWithMosques {
  id: number;
  name: string;
  mosques: { id: number; name: string; region_id: number }[];
}

interface Props {
  rows: BulkReportRow[];
  categoryOptions: Option[];
  priorityOptions: Option[];
  statusOptions: Option[];
  contractorOptions: Option[];
  regionsWithMosques: RegionWithMosques[];
  onChange: (id: string, field: keyof BulkReportRow, value: string) => void;
  onRegionChange: (id: string, regionName: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  maxRows: number;
  /** Optional callback to update multiple fields at once (region + mosque together) */
  onMosqueAutoSelect?: (id: string, regionName: string, mosqueName: string) => void;
}

// Native select is used here for speed: much lighter than shadcn Select and
// works great for keyboard navigation in a table-style fast-entry view.
function SelectCell({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  allowEmpty = true,
}: {
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  allowEmpty?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full h-8 px-2 text-xs border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-400"
    >
      {allowEmpty && <option value="">{placeholder || '—'}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Smart mosque search cell: type mosque name and get auto-suggestions across ALL regions.
 * When a mosque is selected, both the region and mosque_name fields are set automatically.
 *
 * The dropdown is rendered in a portal to `document.body` with fixed positioning so it
 * escapes the table's overflow clipping and can overlay neighboring cells cleanly.
 */
function MosqueSearchCell({
  value,
  regionsWithMosques,
  onSelect,
}: {
  value: string;
  regionsWithMosques: RegionWithMosques[];
  onSelect: (regionName: string, mosqueName: string) => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputWrapperRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync query with external value changes
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Compute dropdown position relative to viewport (fixed positioning)
  const updatePosition = () => {
    if (!inputWrapperRef.current) return;
    const rect = inputWrapperRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  };

  useLayoutEffect(() => {
    if (open) {
      updatePosition();
    }
  }, [open]);

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (!open) return;
    const handleScrollOrResize = () => updatePosition();
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [open]);

  // Close dropdown when clicking outside (both input and dropdown)
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        inputWrapperRef.current && !inputWrapperRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Build flat list of all mosques with region info
  const allMosques = useMemo(() => {
    const list: { mosque: string; region: string }[] = [];
    for (const r of regionsWithMosques) {
      for (const m of r.mosques) {
        list.push({ mosque: m.name, region: r.name });
      }
    }
    return list;
  }, [regionsWithMosques]);

  // Filter by query (case-insensitive, matches anywhere in mosque name)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allMosques.slice(0, 50);
    return allMosques
      .filter((item) => item.mosque.toLowerCase().includes(q))
      .slice(0, 50);
  }, [query, allMosques]);

  const handleSelect = (item: { mosque: string; region: string }) => {
    setQuery(item.mosque);
    onSelect(item.region, item.mosque);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setHighlightedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlightedIdx]) {
        handleSelect(filtered[highlightedIdx]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const dropdown = open && pos ? (
    <div
      ref={dropdownRef}
      dir="rtl"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: Math.max(pos.width, 240),
        zIndex: 9999,
      }}
      className="bg-white border border-gray-200 rounded-md shadow-xl max-h-72 overflow-y-auto"
    >
      {filtered.length === 0 ? (
        <div className="px-3 py-3 text-xs text-gray-500 text-center">
          لا توجد نتائج
        </div>
      ) : (
        filtered.map((item, idx) => (
          <div
            key={`${item.region}-${item.mosque}-${idx}`}
            onMouseDown={(e) => {
              // Use mouseDown so it fires before input blur
              e.preventDefault();
              handleSelect(item);
            }}
            onMouseEnter={() => setHighlightedIdx(idx)}
            className={`px-3 py-2 text-xs cursor-pointer border-b last:border-b-0 border-gray-100 ${
              idx === highlightedIdx ? 'bg-green-50 text-green-800' : 'hover:bg-gray-50'
            }`}
          >
            <div className="font-medium text-gray-800 truncate">{item.mosque}</div>
            <div className="text-[10px] text-gray-500 mt-0.5">📍 {item.region}</div>
          </div>
        ))
      )}
    </div>
  ) : null;

  return (
    <>
      <div ref={inputWrapperRef} className="relative">
        <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlightedIdx(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="ابحث عن المسجد..."
          className="h-8 text-xs pr-7"
        />
      </div>
      {dropdown && createPortal(dropdown, document.body)}
    </>
  );
}

export default function BulkReportTable({
  rows,
  categoryOptions,
  priorityOptions,
  statusOptions,
  contractorOptions,
  regionsWithMosques,
  onChange,
  onRegionChange,
  onRemove,
  onAdd,
  maxRows,
  onMosqueAutoSelect,
}: Props) {
  const handleMosqueSelect = (rowId: string, regionName: string, mosqueName: string) => {
    if (onMosqueAutoSelect) {
      onMosqueAutoSelect(rowId, regionName, mosqueName);
    } else {
      // Fallback: set region first, then mosque
      onRegionChange(rowId, regionName);
      // Next tick so region state change doesn't clear mosque
      setTimeout(() => onChange(rowId, 'mosque_name', mosqueName), 0);
    }
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
        <table className="min-w-full text-xs" dir="rtl">
          <thead className="bg-gray-50 text-gray-700 sticky top-0 z-10">
            <tr className="text-right">
              <th className="px-2 py-2 w-10 text-center">#</th>
              <th className="px-2 py-2 min-w-[160px]">
                العنوان <span className="text-red-500">*</span>
              </th>
              <th className="px-2 py-2 min-w-[200px]">الوصف</th>
              <th className="px-2 py-2 min-w-[130px]">
                القسم <span className="text-red-500">*</span>
              </th>
              <th className="px-2 py-2 min-w-[140px]">
                نوع الإصلاح <span className="text-red-500">*</span>
              </th>
              <th className="px-2 py-2 min-w-[120px]">الحالة</th>
              <th className="px-2 py-2 min-w-[180px]">المسجد <span className="text-red-500">*</span></th>
              <th className="px-2 py-2 min-w-[140px]">المنطقة <span className="text-red-500">*</span></th>
              <th className="px-2 py-2 min-w-[140px]">الجهة المنفذة</th>
              <th className="px-2 py-2 min-w-[140px]">التاريخ</th>
              <th className="px-2 py-2 w-12 text-center">حذف</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.id}
                className="border-t border-gray-100 hover:bg-gray-50/50"
              >
                <td className="px-2 py-1.5 text-center text-gray-500 font-medium">
                  {idx + 1}
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    value={row.title}
                    onChange={(e) => onChange(row.id, 'title', e.target.value)}
                    placeholder="العنوان"
                    className="h-8 text-xs"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    value={row.description}
                    onChange={(e) =>
                      onChange(row.id, 'description', e.target.value)
                    }
                    placeholder="الوصف (اختياري)"
                    className="h-8 text-xs"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <SelectCell
                    value={row.category}
                    options={categoryOptions}
                    onChange={(v) => onChange(row.id, 'category', v)}
                    placeholder="اختر القسم"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <SelectCell
                    value={row.priority}
                    options={priorityOptions}
                    onChange={(v) => onChange(row.id, 'priority', v)}
                    placeholder="اختر نوع الإصلاح"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <SelectCell
                    value={row.status}
                    options={statusOptions}
                    onChange={(v) => onChange(row.id, 'status', v)}
                    placeholder="الحالة"
                    allowEmpty={false}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <MosqueSearchCell
                    value={row.mosque_name}
                    regionsWithMosques={regionsWithMosques}
                    onSelect={(region, mosque) =>
                      handleMosqueSelect(row.id, region, mosque)
                    }
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    value={row.region}
                    onChange={(e) => onRegionChange(row.id, e.target.value)}
                    placeholder="المنطقة"
                    className="h-8 text-xs bg-gray-50"
                    readOnly={!!row.mosque_name}
                  />
                </td>
                <td className="px-2 py-1.5">
                  {contractorOptions.length > 0 ? (
                    <SelectCell
                      value={row.executing_entity}
                      options={contractorOptions}
                      onChange={(v) => onChange(row.id, 'executing_entity', v)}
                      placeholder="الجهة المنفذة"
                    />
                  ) : (
                    <Input
                      value={row.executing_entity}
                      onChange={(e) =>
                        onChange(row.id, 'executing_entity', e.target.value)
                      }
                      placeholder="الجهة المنفذة"
                      className="h-8 text-xs"
                    />
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    <select
                      value={row.date_mode}
                      onChange={(e) => {
                        const mode = e.target.value as 'today' | 'custom';
                        onChange(row.id, 'date_mode', mode);
                        if (mode === 'today') {
                          onChange(row.id, 'custom_date', '');
                        }
                      }}
                      className="h-8 px-1 text-xs border border-gray-200 rounded-md bg-white"
                    >
                      <option value="today">اليوم</option>
                      <option value="custom">مخصص</option>
                    </select>
                    {row.date_mode === 'custom' && (
                      <Input
                        type="date"
                        value={row.custom_date}
                        onChange={(e) =>
                          onChange(row.id, 'custom_date', e.target.value)
                        }
                        className="h-8 text-xs w-32"
                        dir="ltr"
                      />
                    )}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemove(row.id)}
                    disabled={rows.length <= 1}
                    className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-40"
                    title="حذف الصف"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={onAdd}
          disabled={rows.length >= maxRows}
          className="text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200"
        >
          <PlusCircle className="h-4 w-4 ml-1" />
          إضافة صف
        </Button>
        <span className="text-xs text-gray-500">
          {rows.length} / {maxRows} صف
        </span>
      </div>
    </div>
  );
}