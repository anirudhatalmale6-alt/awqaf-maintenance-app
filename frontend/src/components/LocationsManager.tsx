import { useState, useEffect } from 'react';
import { customApi } from '@/lib/customApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  MapPin,
  Building2,
  Plus,
  Pencil,
  Trash2,
  Search,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { RegionWithMosques, MosqueData } from '@/lib/types';

export default function LocationsManager() {
  const [regionsData, setRegionsData] = useState<RegionWithMosques[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRegion, setExpandedRegion] = useState<number | null>(null);
  const [mosqueSearch, setMosqueSearch] = useState('');

  // Add region
  const [addRegionOpen, setAddRegionOpen] = useState(false);
  const [newRegionName, setNewRegionName] = useState('');
  const [addingRegion, setAddingRegion] = useState(false);

  // Edit region
  const [editRegionOpen, setEditRegionOpen] = useState(false);
  const [editRegionId, setEditRegionId] = useState<number | null>(null);
  const [editRegionName, setEditRegionName] = useState('');
  const [savingRegion, setSavingRegion] = useState(false);

  // Delete region
  const [deleteRegionOpen, setDeleteRegionOpen] = useState(false);
  const [deleteRegionData, setDeleteRegionData] = useState<RegionWithMosques | null>(null);
  const [deletingRegion, setDeletingRegion] = useState(false);

  // Add mosque (bulk)
  const [addMosqueOpen, setAddMosqueOpen] = useState(false);
  const [addMosqueRegionId, setAddMosqueRegionId] = useState<number | null>(null);
  const [newMosqueNames, setNewMosqueNames] = useState('');
  const [addingMosque, setAddingMosque] = useState(false);

  // Edit mosque
  const [editMosqueOpen, setEditMosqueOpen] = useState(false);
  const [editMosqueData, setEditMosqueData] = useState<MosqueData | null>(null);
  const [editMosqueName, setEditMosqueName] = useState('');
  const [editMosqueRegionId, setEditMosqueRegionId] = useState<number | null>(null);
  const [savingMosque, setSavingMosque] = useState(false);

  // Delete mosque
  const [deleteMosqueOpen, setDeleteMosqueOpen] = useState(false);
  const [deleteMosqueData, setDeleteMosqueData] = useState<MosqueData | null>(null);
  const [deletingMosque, setDeletingMosque] = useState(false);

  const fetchLocations = async () => {
    try {
      setLoading(true);
      const res = await customApi<RegionWithMosques[]>('/api/v1/locations/regions-with-mosques', 'GET');
      if (res.data) {
        setRegionsData(res.data);
      }
    } catch (err) {
      console.error('Error fetching locations:', err);
      toast.error('فشل في تحميل بيانات المناطق والمساجد');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLocations();
  }, []);

  const toggleRegion = (regionId: number) => {
    setExpandedRegion(expandedRegion === regionId ? null : regionId);
    setMosqueSearch('');
  };

  // --- Region CRUD ---
  const handleAddRegion = async () => {
    if (!newRegionName.trim()) {
      toast.error('يرجى إدخال اسم المنطقة');
      return;
    }
    try {
      setAddingRegion(true);
      await customApi('/api/v1/locations/regions', 'POST', { name: newRegionName.trim() });
      toast.success('تم إضافة المنطقة بنجاح');
      setAddRegionOpen(false);
      setNewRegionName('');
      fetchLocations();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'فشل في إضافة المنطقة');
    } finally {
      setAddingRegion(false);
    }
  };

  const openEditRegion = (r: RegionWithMosques) => {
    setEditRegionId(r.id);
    setEditRegionName(r.name);
    setEditRegionOpen(true);
  };

  const handleEditRegion = async () => {
    if (!editRegionId || !editRegionName.trim()) return;
    try {
      setSavingRegion(true);
      await customApi('/api/v1/locations/regions/update', 'POST', {
        id: editRegionId,
        name: editRegionName.trim(),
      });
      toast.success('تم تعديل المنطقة بنجاح');
      setEditRegionOpen(false);
      fetchLocations();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'فشل في تعديل المنطقة');
    } finally {
      setSavingRegion(false);
    }
  };

  const openDeleteRegion = (r: RegionWithMosques) => {
    setDeleteRegionData(r);
    setDeleteRegionOpen(true);
  };

  const handleDeleteRegion = async () => {
    if (!deleteRegionData) return;
    try {
      setDeletingRegion(true);
      await customApi('/api/v1/locations/regions/delete', 'POST', { id: deleteRegionData.id });
      toast.success('تم حذف المنطقة بنجاح');
      setDeleteRegionOpen(false);
      setDeleteRegionData(null);
      if (expandedRegion === deleteRegionData.id) setExpandedRegion(null);
      fetchLocations();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'فشل في حذف المنطقة');
    } finally {
      setDeletingRegion(false);
    }
  };

  // --- Mosque CRUD ---
  const openAddMosque = (regionId: number) => {
    setAddMosqueRegionId(regionId);
    setNewMosqueNames('');
    setAddMosqueOpen(true);
  };

  const handleAddMosques = async () => {
    if (!addMosqueRegionId) return;
    const names = newMosqueNames
      .split('\n')
      .map((n) => n.trim())
      .filter((n) => n.length > 0);
    if (names.length === 0) {
      toast.error('يرجى إدخال اسم مسجد واحد على الأقل');
      return;
    }
    try {
      setAddingMosque(true);
      const res = await customApi<{ message: string; created: number; skipped: number }>(
        '/api/v1/locations/mosques/bulk',
        'POST',
        { names, region_id: addMosqueRegionId },
      );
      toast.success(res.data?.message || `تم إضافة ${names.length} مسجد بنجاح`);
      setAddMosqueOpen(false);
      setNewMosqueNames('');
      fetchLocations();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'فشل في إضافة المساجد');
    } finally {
      setAddingMosque(false);
    }
  };

  const openEditMosque = (m: MosqueData) => {
    setEditMosqueData(m);
    setEditMosqueName(m.name);
    setEditMosqueRegionId(m.region_id);
    setEditMosqueOpen(true);
  };

  const handleEditMosque = async () => {
    if (!editMosqueData || !editMosqueName.trim()) return;
    try {
      setSavingMosque(true);
      await customApi('/api/v1/locations/mosques/update', 'POST', {
        id: editMosqueData.id,
        name: editMosqueName.trim(),
        region_id: editMosqueRegionId,
      });
      toast.success('تم تعديل المسجد بنجاح');
      setEditMosqueOpen(false);
      fetchLocations();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'فشل في تعديل المسجد');
    } finally {
      setSavingMosque(false);
    }
  };

  const openDeleteMosque = (m: MosqueData) => {
    setDeleteMosqueData(m);
    setDeleteMosqueOpen(true);
  };

  const handleDeleteMosque = async () => {
    if (!deleteMosqueData) return;
    try {
      setDeletingMosque(true);
      await customApi('/api/v1/locations/mosques/delete', 'POST', { id: deleteMosqueData.id });
      toast.success('تم حذف المسجد بنجاح');
      setDeleteMosqueOpen(false);
      setDeleteMosqueData(null);
      fetchLocations();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'فشل في حذف المسجد');
    } finally {
      setDeletingMosque(false);
    }
  };

  const totalMosques = regionsData.reduce((sum, r) => sum + r.mosques.length, 0);

  if (loading) {
    return (
      <Card className="border-l-4 border-l-green-500">
        <CardContent className="p-6">
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin h-8 w-8 border-4 border-green-600 border-t-transparent rounded-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-l-4 border-l-green-500">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <MapPin className="h-5 w-5 text-green-600" />
                إدارة المناطق والمساجد
              </CardTitle>
              <p className="text-sm text-gray-500 mt-1">
                {regionsData.length} منطقة • {totalMosques} مسجد
              </p>
            </div>
            <Button
              onClick={() => { setNewRegionName(''); setAddRegionOpen(true); }}
              className="bg-green-600 hover:bg-green-700 text-white"
              size="sm"
            >
              <Plus className="h-4 w-4 ml-1" />
              إضافة منطقة
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {regionsData.length === 0 ? (
            <div className="text-center py-8">
              <MapPin className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">لا توجد مناطق مسجلة</p>
            </div>
          ) : (
            <div className="space-y-2">
              {regionsData.map((region) => {
                const isExpanded = expandedRegion === region.id;
                const filteredMosques = isExpanded && mosqueSearch.trim()
                  ? region.mosques.filter((m) => m.name.includes(mosqueSearch.trim()))
                  : region.mosques;

                return (
                  <div key={region.id} className="border rounded-lg overflow-hidden">
                    {/* Region Header */}
                    <div
                      className={`flex items-center justify-between p-3 cursor-pointer transition-colors ${
                        isExpanded ? 'bg-green-50 border-b' : 'hover:bg-gray-50'
                      }`}
                      onClick={() => toggleRegion(region.id)}
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-green-600" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        )}
                        <MapPin className="h-4 w-4 text-green-600" />
                        <span className="font-medium text-gray-900">{region.name}</span>
                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                          {region.mosques.length} مسجد
                        </span>
                      </div>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditRegion(region)}
                          className="h-7 w-7 p-0 text-blue-600 hover:bg-blue-50"
                          title="تعديل المنطقة"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openDeleteRegion(region)}
                          className="h-7 w-7 p-0 text-red-600 hover:bg-red-50"
                          title="حذف المنطقة"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openAddMosque(region.id)}
                          className="h-7 px-2 text-green-600 hover:bg-green-50 text-xs"
                          title="إضافة مسجد"
                        >
                          <Plus className="h-3.5 w-3.5 ml-0.5" />
                          مسجد
                        </Button>
                      </div>
                    </div>

                    {/* Mosques List */}
                    {isExpanded && (
                      <div className="bg-white">
                        {region.mosques.length > 5 && (
                          <div className="px-3 pt-2">
                            <div className="relative">
                              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                              <Input
                                placeholder="ابحث عن مسجد..."
                                value={mosqueSearch}
                                onChange={(e) => setMosqueSearch(e.target.value)}
                                className="pr-9 h-8 text-sm"
                              />
                            </div>
                          </div>
                        )}
                        <div className="max-h-72 overflow-y-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-right text-xs">#</TableHead>
                                <TableHead className="text-right text-xs">اسم المسجد</TableHead>
                                <TableHead className="text-right text-xs w-24">إجراءات</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {filteredMosques.map((mosque, idx) => (
                                <TableRow key={mosque.id}>
                                  <TableCell className="text-xs text-gray-400 py-2">{idx + 1}</TableCell>
                                  <TableCell className="py-2">
                                    <div className="flex items-center gap-2">
                                      <Building2 className="h-3.5 w-3.5 text-green-400 flex-shrink-0" />
                                      <span className="text-sm">{mosque.name}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="py-2">
                                    <div className="flex items-center gap-1">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => openEditMosque(mosque)}
                                        className="h-6 w-6 p-0 text-blue-600 hover:bg-blue-50"
                                        title="تعديل"
                                      >
                                        <Pencil className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => openDeleteMosque(mosque)}
                                        className="h-6 w-6 p-0 text-red-600 hover:bg-red-50"
                                        title="حذف"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                              {filteredMosques.length === 0 && (
                                <TableRow>
                                  <TableCell colSpan={3} className="text-center text-sm text-gray-400 py-4">
                                    {mosqueSearch ? 'لا توجد نتائج' : 'لا توجد مساجد في هذه المنطقة'}
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Region Dialog */}
      <Dialog open={addRegionOpen} onOpenChange={setAddRegionOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-green-600" />
              إضافة منطقة جديدة
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>اسم المنطقة *</Label>
              <Input
                placeholder="أدخل اسم المنطقة"
                value={newRegionName}
                onChange={(e) => setNewRegionName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddRegion()}
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleAddRegion}
                disabled={addingRegion}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              >
                {addingRegion ? 'جاري الإضافة...' : 'إضافة المنطقة'}
              </Button>
              <Button variant="outline" onClick={() => setAddRegionOpen(false)}>إلغاء</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Region Dialog */}
      <Dialog open={editRegionOpen} onOpenChange={setEditRegionOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل اسم المنطقة</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>اسم المنطقة *</Label>
              <Input
                value={editRegionName}
                onChange={(e) => setEditRegionName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleEditRegion()}
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleEditRegion}
                disabled={savingRegion}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
              >
                {savingRegion ? 'جاري الحفظ...' : 'حفظ التغييرات'}
              </Button>
              <Button variant="outline" onClick={() => setEditRegionOpen(false)}>إلغاء</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Region Dialog */}
      <Dialog open={deleteRegionOpen} onOpenChange={setDeleteRegionOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              تأكيد حذف المنطقة
            </DialogTitle>
          </DialogHeader>
          {deleteRegionData && (
            <div className="space-y-4 mt-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-800 font-medium mb-2">
                  هل أنت متأكد من حذف منطقة "{deleteRegionData.name}"؟
                </p>
                <p className="text-red-700 text-sm">
                  سيتم حذف المنطقة وجميع المساجد المرتبطة بها ({deleteRegionData.mosques.length} مسجد) نهائياً.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleDeleteRegion}
                  disabled={deletingRegion}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                >
                  {deletingRegion ? 'جاري الحذف...' : 'حذف المنطقة'}
                </Button>
                <Button variant="outline" onClick={() => setDeleteRegionOpen(false)}>إلغاء</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Mosque Dialog (Bulk) */}
      <Dialog open={addMosqueOpen} onOpenChange={setAddMosqueOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-green-600" />
              إضافة مساجد
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
              <p className="text-green-800">
                المنطقة: <strong>{regionsData.find((r) => r.id === addMosqueRegionId)?.name}</strong>
              </p>
            </div>
            <div className="space-y-2">
              <Label>أسماء المساجد *</Label>
              <Textarea
                placeholder={"أدخل اسم كل مسجد في سطر منفصل\nمثال:\nمسجد الأول\nمسجد الثاني\nمسجد الثالث"}
                value={newMosqueNames}
                onChange={(e) => setNewMosqueNames(e.target.value)}
                rows={6}
                className="resize-y min-h-[120px]"
              />
              <p className="text-xs text-gray-500">
                كل سطر = مسجد واحد • عدد المساجد:{' '}
                <strong>
                  {newMosqueNames.split('\n').filter((n) => n.trim().length > 0).length}
                </strong>
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleAddMosques}
                disabled={addingMosque}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              >
                {addingMosque ? 'جاري الإضافة...' : 'إضافة المساجد'}
              </Button>
              <Button variant="outline" onClick={() => setAddMosqueOpen(false)}>إلغاء</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Mosque Dialog */}
      <Dialog open={editMosqueOpen} onOpenChange={setEditMosqueOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل بيانات المسجد</DialogTitle>
          </DialogHeader>
          {editMosqueData && (
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>اسم المسجد *</Label>
                <Input
                  value={editMosqueName}
                  onChange={(e) => setEditMosqueName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>المنطقة</Label>
                <Select
                  value={String(editMosqueRegionId)}
                  onValueChange={(val) => setEditMosqueRegionId(Number(val))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {regionsData.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleEditMosque}
                  disabled={savingMosque}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {savingMosque ? 'جاري الحفظ...' : 'حفظ التغييرات'}
                </Button>
                <Button variant="outline" onClick={() => setEditMosqueOpen(false)}>إلغاء</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Mosque Dialog */}
      <Dialog open={deleteMosqueOpen} onOpenChange={setDeleteMosqueOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              تأكيد حذف المسجد
            </DialogTitle>
          </DialogHeader>
          {deleteMosqueData && (
            <div className="space-y-4 mt-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-800 font-medium">
                  هل أنت متأكد من حذف مسجد "{deleteMosqueData.name}"؟
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleDeleteMosque}
                  disabled={deletingMosque}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                >
                  {deletingMosque ? 'جاري الحذف...' : 'حذف المسجد'}
                </Button>
                <Button variant="outline" onClick={() => setDeleteMosqueOpen(false)}>إلغاء</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}