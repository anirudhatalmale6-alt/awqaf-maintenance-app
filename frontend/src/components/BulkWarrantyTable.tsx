import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, PlusCircle, Search, Check } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

/**
 * BulkWarrantyTable
 * -----------------
 * Spreadsheet-style row editor for the "إنشاء جماعي للكفالات" dialog.
 * Modeled after BulkReportTable so the look-and-feel matches the existing
 * "إنشاء بلاغات متعددة" UI exactly: native selects, smart mosque search with
 * region auto-fill, and an "إضافة صف / N / MAX" footer with a delete button
 * per row.
 *
 * BUGFIX (2026-05-17): The mosque dropdown is now rendered via Radix Popover
 * + cmdk Command instead of a hand-rolled portal-to-body. Radix Popover
 * integrates correctly with the parent Dialog's focus trap & pointer-events
 * management, so mouse interaction inside the dropdown works reliably.
 */

export interface BulkWarrantyRow {
  id: string;
  title: string;
  notes: string;
  category: string; // label snapshot, e.g. "كهرباء"
  category_value: string; // backend value/key, e.g. "electrical"
  mosque_id: number | null;
  mosque_name: string;
  region_id: number | null;
  region_name: string;
  contractor_id: number | null;
  contractor_label: string;
  contractor_value: string;
  start_date: string; // YYYY-MM-DD
  duration_months: number;
  status: "active" | "claimed" | "expired" | "cancelled";
}

export interface CategoryOption {
  value: string;
  label: string;
}

export interface RegionWithMosquesLite {
  id: number;
  name: string;
  mosques: { id: number; name: string }[];
}

export interface ContractorOption {
  id: number;
  value: string;
  label: string;
}

interface Props {
  rows: BulkWarrantyRow[];
  regions: RegionWithMosquesLite[];
  contractors: ContractorOption[];
  categories?: CategoryOption[];
  onChange: <K extends keyof BulkWarrantyRow>(
    id: string,
    field: K,
    value: BulkWarrantyRow[K],
  ) => void;
  onMosqueSelect: (
    rowId: string,
    mosqueId: number,
    mosqueName: string,
    regionId: number | null,
    regionName: string,
  ) => void;
  onContractorSelect: (rowId: string, contractor: ContractorOption | null) => void;
  onCategorySelect?: (rowId: string, category: CategoryOption | null) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  maxRows: number;
}

const STATUS_OPTIONS = [
  { value: "active", label: "سارية" },
  { value: "claimed", label: "مُطالب بها" },
  { value: "expired", label: "منتهية" },
  { value: "cancelled", label: "ملغاة" },
];

/** Lightweight native <select> styled like the Bulk reports table cells. */
function SelectCell({
  value,
  options,
  onChange,
  placeholder,
  allowEmpty = true,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-8 px-2 text-xs border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent dark:bg-slate-900 dark:border-slate-700 dark:text-gray-100"
    >
      {allowEmpty && <option value="">{placeholder || "—"}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * MosqueSearchCell — type-ahead search across all mosques across all regions.
 * Uses Radix Popover + cmdk Command which integrates correctly with the
 * parent Dialog's focus trap, so mouse + keyboard interaction inside the
 * dropdown works reliably even inside a modal Dialog.
 */
function MosqueSearchCell({
  value,
  regions,
  onSelect,
}: {
  value: string;
  regions: RegionWithMosquesLite[];
  onSelect: (
    mosqueId: number,
    mosqueName: string,
    regionId: number,
    regionName: string,
  ) => void;
}) {
  const [open, setOpen] = useState(false);

  const allMosques = useMemo(() => {
    const list: {
      mosque_id: number;
      mosque: string;
      region_id: number;
      region: string;
    }[] = [];
    for (const r of regions) {
      for (const m of r.mosques) {
        list.push({
          mosque_id: m.id,
          mosque: m.name,
          region_id: r.id,
          region: r.name,
        });
      }
    }
    return list;
  }, [regions]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full h-8 px-2 text-xs justify-between font-normal",
            !value && "text-gray-400",
          )}
        >
          <span className="truncate flex items-center gap-1">
            <Search className="h-3 w-3 text-gray-400 shrink-0" />
            <span className="truncate">{value || "ابحث عن المسجد..."}</span>
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[300px] p-0"
        align="start"
        dir="rtl"
        // Prevent the parent Dialog from stealing focus when interacting
        // with the popover.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command
          filter={(itemValue, search) => {
            // itemValue is a unique key like "mid-rid"; we need the mosque
            // name for filtering, so we encode it into the value too.
            // The actual filtering logic uses the search string against the
            // CommandItem's text content (default behavior). Returning 1
            // for non-matches lets the default text matching take over.
            if (!search.trim()) return 1;
            return itemValue.toLowerCase().includes(search.toLowerCase())
              ? 1
              : 0;
          }}
        >
          <CommandInput placeholder="ابحث عن مسجد..." className="h-9 text-xs" />
          <CommandList>
            <CommandEmpty className="py-3 text-xs text-center text-gray-500">
              لا توجد نتائج
            </CommandEmpty>
            <CommandGroup>
              {allMosques.map((it) => {
                const isSelected = value === it.mosque;
                // Use a value that includes the mosque name so cmdk's default
                // text filter matches against it.
                const cmdValue = `${it.mosque} ${it.region}`;
                return (
                  <CommandItem
                    key={`${it.region_id}-${it.mosque_id}`}
                    value={cmdValue}
                    onSelect={() => {
                      onSelect(
                        it.mosque_id,
                        it.mosque,
                        it.region_id,
                        it.region,
                      );
                      setOpen(false);
                    }}
                    className="text-xs cursor-pointer"
                  >
                    <Check
                      className={cn(
                        "ml-2 h-3 w-3 shrink-0",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <span className="font-medium truncate">{it.mosque}</span>
                      <span className="text-[10px] text-gray-500">
                        📍 {it.region}
                      </span>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function BulkWarrantyTable({
  rows,
  regions,
  contractors,
  categories = [],
  onChange,
  onMosqueSelect,
  onContractorSelect,
  onCategorySelect,
  onRemove,
  onAdd,
  maxRows,
}: Props) {
  const contractorOptions = useMemo(
    () => contractors.map((c) => ({ value: String(c.id), label: c.label })),
    [contractors],
  );

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ value: c.value, label: c.label })),
    [categories],
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900">
        <table className="min-w-full text-xs" dir="rtl">
          <thead className="bg-gray-50 dark:bg-slate-800/60 text-gray-700 dark:text-gray-200 sticky top-0 z-10">
            <tr className="text-right">
              <th className="px-2 py-2 w-10 text-center">#</th>
              <th className="px-2 py-2 min-w-[180px]">
                العنوان <span className="text-red-500">*</span>
              </th>
              <th className="px-2 py-2 min-w-[200px]">
                المسجد <span className="text-red-500">*</span>
              </th>
              <th className="px-2 py-2 min-w-[140px]">المنطقة</th>
              <th className="px-2 py-2 min-w-[140px]">التصنيف</th>
              <th className="px-2 py-2 min-w-[160px]">
                المقاول <span className="text-red-500">*</span>
              </th>
              <th className="px-2 py-2 min-w-[160px]">
                تاريخ البداية <span className="text-red-500">*</span>
              </th>
              <th className="px-2 py-2 min-w-[110px]">
                المدة (شهر) <span className="text-red-500">*</span>
              </th>
              <th className="px-2 py-2 min-w-[120px]">الحالة</th>
              <th className="px-2 py-2 min-w-[200px]">الملاحظات</th>
              <th className="px-2 py-2 w-12 text-center">حذف</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.id}
                className="border-t border-gray-100 dark:border-slate-700 hover:bg-gray-50/50 dark:hover:bg-slate-800/30"
              >
                <td className="px-2 py-1.5 text-center text-gray-500 font-medium">
                  {idx + 1}
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    value={row.title}
                    onChange={(e) => onChange(row.id, "title", e.target.value)}
                    placeholder="عنوان البند"
                    className="h-8 text-xs"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <MosqueSearchCell
                    value={row.mosque_name}
                    regions={regions}
                    onSelect={(mid, mname, rid, rname) =>
                      onMosqueSelect(row.id, mid, mname, rid, rname)
                    }
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    value={row.region_name}
                    readOnly
                    placeholder="—"
                    className="h-8 text-xs bg-gray-50 dark:bg-slate-800/40"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <SelectCell
                    value={row.category_value || ""}
                    options={categoryOptions}
                    onChange={(v) => {
                      if (!v) {
                        if (onCategorySelect) onCategorySelect(row.id, null);
                        else {
                          onChange(row.id, "category", "");
                          onChange(row.id, "category_value", "");
                        }
                        return;
                      }
                      const c = categories.find((x) => x.value === v);
                      if (onCategorySelect) {
                        onCategorySelect(row.id, c || null);
                      } else if (c) {
                        onChange(row.id, "category", c.label);
                        onChange(row.id, "category_value", c.value);
                      }
                    }}
                    placeholder="اختر التصنيف"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <SelectCell
                    value={row.contractor_id ? String(row.contractor_id) : ""}
                    options={contractorOptions}
                    onChange={(v) => {
                      if (!v) {
                        onContractorSelect(row.id, null);
                        return;
                      }
                      const c = contractors.find((x) => String(x.id) === v);
                      onContractorSelect(row.id, c || null);
                    }}
                    placeholder="اختر المقاول"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    <Input
                      type="date"
                      value={row.start_date}
                      onChange={(e) =>
                        onChange(row.id, "start_date", e.target.value)
                      }
                      className="h-8 text-xs flex-1"
                      dir="ltr"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onChange(row.id, "start_date", today)}
                      className="h-8 px-2 text-[10px] shrink-0"
                      title="اليوم"
                    >
                      اليوم
                    </Button>
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    type="number"
                    min={1}
                    max={120}
                    value={row.duration_months}
                    onChange={(e) =>
                      onChange(
                        row.id,
                        "duration_months",
                        Math.max(1, Number(e.target.value) || 1),
                      )
                    }
                    className="h-8 text-xs"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <SelectCell
                    value={row.status}
                    options={STATUS_OPTIONS}
                    onChange={(v) =>
                      onChange(row.id, "status", v as BulkWarrantyRow["status"])
                    }
                    placeholder="الحالة"
                    allowEmpty={false}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    value={row.notes}
                    onChange={(e) => onChange(row.id, "notes", e.target.value)}
                    placeholder="ملاحظات (اختياري)"
                    className="h-8 text-xs"
                  />
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
          className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 border-emerald-200 dark:border-emerald-800 dark:hover:bg-emerald-950/30"
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