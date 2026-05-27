import { useEffect, useMemo, useState } from 'react';
import { customApi, friendlyErrorMessage } from '@/lib/customApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  EyeOff,
  Layers,
  UserCircle,
  Settings2,
  ChevronDown,
  ChevronUp,
  Trash2,
  Plus,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useStatuses } from '@/lib/useStatuses';
import { useCategories } from '@/lib/useCategories';

interface HideStatusCardsStatus {
  enabled: boolean;
}

interface WhitelistResponse {
  values: string[];
}

interface PerCategoryResponse {
  values: Record<string, string[]>;
}

/**
 * Admin settings for the reports-page status-cards visibility, with two
 * independent layers of increasing precision:
 *
 *   1. Global toggle + per-card whitelist (`visible_status_cards_whitelist`):
 *      Coarse fallback. Applied when nothing more specific matches.
 *
 *   2. Per-category map (`status_cards_per_category_whitelist`):
 *      For each listed category, the EXACT set of cards to show in that
 *      department. Highest precision — overrides the layer above.
 *
 * The "بدون تصنيف" 3-way filter is independent and never affected.
 */
export default function HideStatusCardsSettings() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [whitelist, setWhitelist] = useState<string[]>([]);
  const [pendingWhitelist, setPendingWhitelist] = useState<string[] | null>(null);
  const [whitelistLoading, setWhitelistLoading] = useState(true);
  const [savingWhitelist, setSavingWhitelist] = useState(false);

  // Per-category fine-grained map state.
  const [perCategoryMap, setPerCategoryMap] = useState<Record<string, string[]>>({});
  const [pendingPerCategoryMap, setPendingPerCategoryMap] = useState<
    Record<string, string[]> | null
  >(null);
  const [perCategoryLoading, setPerCategoryLoading] = useState(true);
  const [savingPerCategory, setSavingPerCategory] = useState(false);
  const [expandedCategoryKey, setExpandedCategoryKey] = useState<string | null>(null);
  const [addCategoryPickerValue, setAddCategoryPickerValue] = useState<string>('');

  const { options: statusOptions } = useStatuses();
  const { options: categoryOptions } = useCategories();

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [toggleRes, whitelistRes, perCatRes] = await Promise.all([
          customApi<HideStatusCardsStatus>(
            '/api/v1/app-settings/hide-status-cards',
            'GET',
          ),
          customApi<WhitelistResponse>(
            '/api/v1/app-settings/visible-status-cards-whitelist',
            'GET',
          ),
          customApi<PerCategoryResponse>(
            '/api/v1/app-settings/status-cards-per-category-whitelist',
            'GET',
          ),
        ]);
        if (!mounted) return;
        if (toggleRes.data) setEnabled(!!toggleRes.data.enabled);
        if (whitelistRes.data && Array.isArray(whitelistRes.data.values)) {
          setWhitelist(whitelistRes.data.values);
        }
        if (
          perCatRes.data &&
          perCatRes.data.values &&
          typeof perCatRes.data.values === 'object'
        ) {
          setPerCategoryMap(perCatRes.data.values);
        }
      } catch {
        // Non-blocking.
      } finally {
        if (mounted) {
          setLoading(false);
          setWhitelistLoading(false);
          setPerCategoryLoading(false);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const handleToggle = async (next: boolean) => {
    setSaving(true);
    const prev = enabled;
    setEnabled(next); // optimistic
    try {
      const res = await customApi<HideStatusCardsStatus>(
        '/api/v1/app-settings/hide-status-cards',
        'PUT',
        { enabled: next },
      );
      if (res.data) setEnabled(!!res.data.enabled);
      toast.success(
        next
          ? 'تم إخفاء بطاقات حالات البلاغ في صفحة البلاغات'
          : 'تم إظهار بطاقات حالات البلاغ في صفحة البلاغات',
      );
    } catch (err) {
      setEnabled(prev); // revert on failure
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  // Build the list of candidate cards (special + real statuses).
  const candidates = useMemo(
    () => [
      { value: 'all', label: 'الكل', icon: Layers },
      { value: '__my_reports__', label: 'بلاغاتي', icon: UserCircle },
      ...statusOptions.map((s) => ({
        value: s.value,
        label: s.label,
        icon: null as null,
      })),
    ],
    [statusOptions],
  );

  const currentSelection = pendingWhitelist ?? whitelist;
  const hasPending = pendingWhitelist !== null;

  const togglePending = (value: string, checked: boolean) => {
    const base = new Set(currentSelection);
    if (checked) base.add(value);
    else base.delete(value);
    setPendingWhitelist(Array.from(base));
  };

  const savePending = async () => {
    if (pendingWhitelist === null) return;
    setSavingWhitelist(true);
    try {
      const res = await customApi<WhitelistResponse>(
        '/api/v1/app-settings/visible-status-cards-whitelist',
        'PUT',
        { values: pendingWhitelist },
      );
      if (res.data && Array.isArray(res.data.values)) {
        setWhitelist(res.data.values);
      } else {
        setWhitelist(pendingWhitelist);
      }
      setPendingWhitelist(null);
      toast.success('تم حفظ قائمة الاستثناءات');
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSavingWhitelist(false);
    }
  };

  const cancelPending = () => setPendingWhitelist(null);

  // Categories candidates: every real category + an explicit "بدون تصنيف"
  // entry mapped to the internal `__uncategorized__` key. Used by the
  // per-category fine-grained section.
  const categoryCandidates = useMemo(
    () => [
      ...categoryOptions.map((c) => ({ value: c.value, label: c.label })),
      { value: '__uncategorized__', label: 'بدون تصنيف' },
    ],
    [categoryOptions],
  );

  // ───── Per-category fine-grained controls ─────
  const currentPerCategory = pendingPerCategoryMap ?? perCategoryMap;
  const hasPendingPerCategory = pendingPerCategoryMap !== null;

  const configuredCategoryKeys = useMemo(
    () => Object.keys(currentPerCategory),
    [currentPerCategory],
  );

  const labelForCategory = (key: string): string => {
    if (key === '__uncategorized__') return 'بدون تصنيف';
    const found = categoryCandidates.find((c) => c.value === key);
    return found ? found.label : key;
  };

  const labelForCard = (key: string): string => {
    if (key === 'all') return 'الكل';
    if (key === '__my_reports__') return 'بلاغاتي';
    const found = statusOptions.find((s) => s.value === key);
    return found ? found.label : key;
  };

  const availableCategoriesForAdd = useMemo(
    () =>
      categoryCandidates.filter(
        (c) => !Object.prototype.hasOwnProperty.call(currentPerCategory, c.value),
      ),
    [categoryCandidates, currentPerCategory],
  );

  const addCategoryToPerMap = (key: string) => {
    if (!key) return;
    if (Object.prototype.hasOwnProperty.call(currentPerCategory, key)) return;
    const next = { ...currentPerCategory, [key]: [] };
    setPendingPerCategoryMap(next);
    setExpandedCategoryKey(key);
    setAddCategoryPickerValue('');
  };

  const removeCategoryFromPerMap = (key: string) => {
    const next = { ...currentPerCategory };
    delete next[key];
    setPendingPerCategoryMap(next);
    if (expandedCategoryKey === key) setExpandedCategoryKey(null);
  };

  const togglePerCategoryCard = (
    catKey: string,
    cardValue: string,
    checked: boolean,
  ) => {
    const existing = currentPerCategory[catKey] ?? [];
    const setOf = new Set(existing);
    if (checked) setOf.add(cardValue);
    else setOf.delete(cardValue);
    const next = { ...currentPerCategory, [catKey]: Array.from(setOf) };
    setPendingPerCategoryMap(next);
  };

  const cancelPendingPerCategory = () => {
    setPendingPerCategoryMap(null);
    setExpandedCategoryKey(null);
    setAddCategoryPickerValue('');
  };

  const savePendingPerCategory = async () => {
    if (pendingPerCategoryMap === null) return;
    setSavingPerCategory(true);
    try {
      const res = await customApi<PerCategoryResponse>(
        '/api/v1/app-settings/status-cards-per-category-whitelist',
        'PUT',
        { values: pendingPerCategoryMap },
      );
      if (
        res.data &&
        res.data.values &&
        typeof res.data.values === 'object'
      ) {
        setPerCategoryMap(res.data.values);
      } else {
        setPerCategoryMap(pendingPerCategoryMap);
      }
      setPendingPerCategoryMap(null);
      setExpandedCategoryKey(null);
      toast.success('تم حفظ إعدادات بطاقات الأقسام');
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSavingPerCategory(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <EyeOff className="h-5 w-5 text-slate-600" />
          إخفاء بطاقات حالات البلاغ
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
          <div className="space-y-1 pe-4">
            <Label htmlFor="hide-status-cards-toggle" className="text-base font-medium">
              إخفاء بطاقات حالات البلاغ في صفحة البلاغات
            </Label>
            <p className="text-sm text-muted-foreground leading-6">
              عند التفعيل، تختفي جميع بطاقات الحالات (جاري الكشف، مغلق، ... إلخ) من
              صفحة البلاغات لجميع الأقسام، وتُعرض كل البلاغات بدون فلترة حسب الحالة.
              يمكنك استثناء بطاقات معينة لإبقائها ظاهرة من قائمة "الاستثناءات" أدناه.
              ملاحظة: وضع "بلاغ قيد التصنيف" (البطاقات الثلاث: بلاغ جديد / بلاغاتي / الكل)
              يبقى كما هو ولا يتأثر بهذا الإعداد.
            </p>
          </div>
          <Switch
            id="hide-status-cards-toggle"
            checked={enabled}
            disabled={saving}
            onCheckedChange={handleToggle}
          />
        </div>

        {/* Exceptions / whitelist (per-card) */}
        <div
          className={`p-4 rounded-lg border bg-muted/30 space-y-3 transition-opacity ${
            enabled ? 'opacity-100' : 'opacity-60'
          }`}
        >
          <div className="space-y-1">
            <Label className="text-base font-medium">
              استثناءات: بطاقات تظل ظاهرة رغم التفعيل
            </Label>
            <p className="text-sm text-muted-foreground leading-6">
              اختر البطاقات التي يجب إبقاؤها ظاهرة للمستخدمين حتى عند تفعيل الإخفاء.
              إذا لم تختر أي بطاقة، سيتم إخفاؤها جميعاً.
              {!enabled && (
                <span className="block text-amber-600 dark:text-amber-400 mt-1">
                  (يتم تطبيق الاستثناءات فقط عند تفعيل الإخفاء بالأعلى.)
                </span>
              )}
            </p>
          </div>

          {whitelistLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {candidates.map((c) => {
                const checked = currentSelection.includes(c.value);
                const Icon = c.icon;
                return (
                  <label
                    key={c.value}
                    className={`flex items-center gap-2 p-2.5 rounded-md border cursor-pointer transition-colors ${
                      checked
                        ? 'bg-primary/5 border-primary/40'
                        : 'bg-background hover:bg-muted'
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => togglePending(c.value, !!v)}
                      disabled={savingWhitelist}
                    />
                    {Icon && <Icon className="h-4 w-4 text-muted-foreground shrink-0" />}
                    <span className="text-sm truncate">{c.label}</span>
                  </label>
                );
              })}
            </div>
          )}

          {hasPending && (
            <div className="flex items-center justify-end gap-2 pt-2 border-t">
              <Button
                variant="ghost"
                size="sm"
                onClick={cancelPending}
                disabled={savingWhitelist}
              >
                إلغاء
              </Button>
              <Button
                size="sm"
                onClick={savePending}
                disabled={savingWhitelist}
              >
                {savingWhitelist && (
                  <Loader2 className="h-4 w-4 animate-spin ml-2" />
                )}
                حفظ التغييرات
              </Button>
            </div>
          )}
        </div>

        {/* Per-category fine-grained: which cards show in each department */}
        <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
          <div className="space-y-1">
            <Label className="text-base font-medium flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-indigo-600" />
              تحكم دقيق: بطاقات كل قسم
            </Label>
            <p className="text-sm text-muted-foreground leading-6">
              لكل قسم، اختر البطاقات التي ستظهر فيه فقط. الأقسام غير المُعدَّة هنا
              تتبع الإعداد العام أعلاه (الإخفاء العام مع قائمة استثناء البطاقات).
              هذا الإعداد له الأولوية القصوى ويعمل حتى لو كان الإخفاء العام
              مُعطَّلاً — فهو يحدد بدقة ما يُعرض داخل القسم.
            </p>
          </div>

          {/* Add-category picker */}
          {!perCategoryLoading && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <Select
                value={addCategoryPickerValue}
                onValueChange={(v) => setAddCategoryPickerValue(v)}
                disabled={savingPerCategory || availableCategoriesForAdd.length === 0}
              >
                <SelectTrigger className="sm:max-w-xs">
                  <SelectValue
                    placeholder={
                      availableCategoriesForAdd.length === 0
                        ? 'تم إضافة جميع الأقسام'
                        : 'اختر قسماً لإضافته…'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableCategoriesForAdd.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={() => addCategoryToPerMap(addCategoryPickerValue)}
                disabled={
                  !addCategoryPickerValue ||
                  savingPerCategory ||
                  availableCategoriesForAdd.length === 0
                }
              >
                <Plus className="h-4 w-4 ml-1" />
                إضافة قسم
              </Button>
            </div>
          )}

          {perCategoryLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : configuredCategoryKeys.length === 0 ? (
            <div className="text-sm text-muted-foreground py-3 text-center bg-background rounded-md border border-dashed">
              لم تُضِف أي قسم بعد — أضف قسماً من الأعلى لتخصيص بطاقاته.
            </div>
          ) : (
            <div className="space-y-2">
              {configuredCategoryKeys.map((catKey) => {
                const cards = currentPerCategory[catKey] ?? [];
                const isExpanded = expandedCategoryKey === catKey;
                const summary =
                  cards.length === 0
                    ? 'لم تُحدَّد أي بطاقة (سيتم إخفاء جميع البطاقات في هذا القسم)'
                    : cards
                        .slice(0, 3)
                        .map(labelForCard)
                        .join('، ') +
                      (cards.length > 3 ? ` +${cards.length - 3}` : '');
                return (
                  <div
                    key={catKey}
                    className="rounded-md border bg-background overflow-hidden"
                  >
                    <div className="flex items-center justify-between gap-2 p-3">
                      <button
                        type="button"
                        className="flex-1 min-w-0 text-right flex items-center gap-2 hover:opacity-80 transition-opacity"
                        onClick={() =>
                          setExpandedCategoryKey(isExpanded ? null : catKey)
                        }
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {labelForCategory(catKey)}
                          </div>
                          <div className="text-xs text-muted-foreground truncate mt-0.5">
                            {summary}
                          </div>
                        </div>
                        <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 text-xs font-bold shrink-0">
                          {cards.length}
                        </span>
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeCategoryFromPerMap(catKey)}
                        disabled={savingPerCategory}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0"
                        title="مسح هذا القسم (يعود للسلوك العام)"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {isExpanded && (
                      <div className="border-t bg-muted/20 p-3 space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                          {candidates.map((c) => {
                            const checked = cards.includes(c.value);
                            const Icon = c.icon;
                            return (
                              <label
                                key={c.value}
                                className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors text-sm ${
                                  checked
                                    ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-300 dark:border-indigo-700'
                                    : 'bg-background hover:bg-muted'
                                }`}
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(v) =>
                                    togglePerCategoryCard(catKey, c.value, !!v)
                                  }
                                  disabled={savingPerCategory}
                                />
                                {Icon && (
                                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                                )}
                                <span className="truncate">{c.label}</span>
                              </label>
                            );
                          })}
                        </div>
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <p className="text-xs text-muted-foreground">
                            اختر بطاقة واحدة على الأقل، وإلا ستُخفى جميع البطاقات
                            في هذا القسم.
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setExpandedCategoryKey(null)}
                          >
                            <X className="h-3.5 w-3.5 ml-1" />
                            طي
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {hasPendingPerCategory && (
            <div className="flex items-center justify-end gap-2 pt-2 border-t">
              <Button
                variant="ghost"
                size="sm"
                onClick={cancelPendingPerCategory}
                disabled={savingPerCategory}
              >
                إلغاء
              </Button>
              <Button
                size="sm"
                onClick={savePendingPerCategory}
                disabled={savingPerCategory}
              >
                {savingPerCategory && (
                  <Loader2 className="h-4 w-4 animate-spin ml-2" />
                )}
                حفظ تخصيصات الأقسام
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}