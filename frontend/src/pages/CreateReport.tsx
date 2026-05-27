import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { customApi } from '@/lib/customApi';
import Header from '@/components/Header';
import EditableText from '@/components/EditableText';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Combobox } from '@/components/ui/combobox';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ArrowRight, Upload, X, User, Phone, MapPin, Building2, Megaphone, FileText, UserCheck, UserX, Wrench, ChevronRight, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { REPORTER_ROLE_OPTIONS, RegionWithMosques } from '@/lib/types';
import { useCategories } from '@/lib/useCategories';
import { usePriorities } from '@/lib/usePriorities';
import { useContractors } from '@/lib/useContractors';


/** Check if a File is a PDF */
function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

/** Check if a File is an image */
function isImage(file: File): boolean {
  return file.type.startsWith('image/');
}

/** Accepted file types for the input */
const ACCEPTED_FILE_TYPES = 'image/*,.pdf,application/pdf';

/** Dialog step type */
type DialogStep = 'engineer' | 'contractor';

export default function CreateReportPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, logout, hasPermission } = useAuth();
  const isGuest = !user;
  const { options: categoryOptions } = useCategories();
  const { options: priorityOptions } = usePriorities();
  const { contractors, loading: contractorsLoading } = useContractors();

  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [reporterName, setReporterName] = useState('');
  const [reporterPhone, setReporterPhone] = useState('');
  const [reporterRole, setReporterRole] = useState('');
  const [region, setRegion] = useState('');
  const [mosqueName, setMosqueName] = useState('');

  // Engineer assignment confirmation dialog
  const [showDialog, setShowDialog] = useState(false);
  const [dialogStep, setDialogStep] = useState<DialogStep>('engineer');
  const [selectedContractor, setSelectedContractor] = useState('');

  const [dateMode, setDateMode] = useState<'today' | 'custom'>('today');
  const [customDate, setCustomDate] = useState('');

  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<{ url: string; type: 'image' | 'pdf'; name: string }[]>([]);
  const [regionsData, setRegionsData] = useState<RegionWithMosques[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [guestAnnouncement, setGuestAnnouncement] = useState<{ message: string; admin_name: string; created_at: string | null } | null>(null);

  // Fetch guest announcement for visitors
  useEffect(() => {
    if (!isGuest) return;
    const fetchGuestAnnouncement = async () => {
      try {
        const res = await customApi<{ announcement: { message: string; admin_name: string; created_at: string | null } | null }>(
          '/api/v1/guest-announcements/active',
          'GET'
        );
        if (res.data?.announcement) {
          setGuestAnnouncement(res.data.announcement);
        }
      } catch {
        // Silently fail - announcement is not critical
      }
    };
    fetchGuestAnnouncement();
  }, [isGuest]);

  // Fetch regions and mosques on mount
  useEffect(() => {
    const fetchLocations = async () => {
      try {
        const res = await customApi<RegionWithMosques[]>('/api/v1/locations/regions-with-mosques', 'GET');
        if (res.data) {
          setRegionsData(res.data);
        }
      } catch (err) {
        console.error('Error fetching locations:', err);
      } finally {
        setLoadingLocations(false);
      }
    };
    fetchLocations();
  }, []);

  // Get mosques for selected region
  const selectedRegionData = useMemo(() => {
    return regionsData.find((r) => r.name === region);
  }, [regionsData, region]);

  // Flat list of ALL mosques across all regions, each labeled with its region
  // for quick search-and-auto-fill-region behavior.
  const allMosquesFlat = useMemo(() => {
    const list: { mosqueName: string; regionName: string }[] = [];
    regionsData.forEach((r) => {
      r.mosques.forEach((m) => {
        list.push({ mosqueName: m.name, regionName: r.name });
      });
    });
    // De-duplicate by "mosqueName||regionName" to keep identical names in different regions distinguishable
    return list;
  }, [regionsData]);

  // Build options for the mosque combobox.
  // When a region is selected, show ONLY mosques in that region (label without
  // region suffix since it's redundant). Otherwise show all mosques labeled
  // with their region for global search-and-auto-fill behavior.
  // value encodes both mosque and region: "mosqueName||regionName" to disambiguate duplicates.
  const globalMosqueOptions = useMemo(() => {
    if (region && selectedRegionData) {
      return selectedRegionData.mosques.map((m) => ({
        value: `${m.name}||${region}`,
        label: m.name,
      }));
    }
    return allMosquesFlat.map(({ mosqueName, regionName }) => ({
      value: `${mosqueName}||${regionName}`,
      label: `${mosqueName} — ${regionName}`,
    }));
  }, [allMosquesFlat, region, selectedRegionData]);

  // Current encoded value for the global mosque combobox
  const currentGlobalMosqueValue = useMemo(() => {
    if (!mosqueName) return '';
    if (region) return `${mosqueName}||${region}`;
    // Fallback: first match by mosque name only
    const match = allMosquesFlat.find((m) => m.mosqueName === mosqueName);
    return match ? `${match.mosqueName}||${match.regionName}` : '';
  }, [mosqueName, region, allMosquesFlat]);

  /**
   * Handle selection from the global mosque combobox.
   * Auto-fills the region based on the chosen mosque.
   */
  const handleGlobalMosqueChange = (encodedValue: string) => {
    if (!encodedValue) {
      setMosqueName('');
      return;
    }
    const [mName, rName] = encodedValue.split('||');
    setMosqueName(mName || '');
    if (rName && rName !== region) {
      setRegion(rName);
    }
  };

  // Reset mosque when region changes
  const handleRegionChange = (val: string) => {
    setRegion(val);
    setMosqueName('');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    const validFiles = selectedFiles.filter((f) => isImage(f) || isPdf(f));

    if (validFiles.length === 0) {
      toast.error('يرجى اختيار صور أو ملفات PDF فقط');
      return;
    }

    if (validFiles.length + files.length > 5) {
      toast.error('الحد الأقصى 5 ملفات');
      return;
    }

    // Check file sizes (max 10MB each)
    for (const file of validFiles) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`الملف "${file.name}" كبير جداً (الحد الأقصى 10 ميجابايت)`);
        return;
      }
    }

    setFiles((prev) => [...prev, ...validFiles]);

    validFiles.forEach((file) => {
      if (isPdf(file)) {
        setPreviews((prev) => [...prev, { url: '', type: 'pdf', name: file.name }]);
      } else {
        const reader = new FileReader();
        reader.onload = (ev) => {
          setPreviews((prev) => [...prev, { url: ev.target?.result as string, type: 'image', name: file.name }]);
        };
        reader.readAsDataURL(file);
      }
    });

    e.target.value = '';
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadFile = async (file: File, reportId: number | string) => {
    const timestamp = Date.now();
    const safeFileName = file.name.replace(/[^A-Za-z0-9._-]/g, '-');
    const objectKey = `reports/${reportId}/${timestamp}_${safeFileName}`;

    const urlRes = await customApi<{ upload_url: string }>('/api/v1/guest/upload-url', 'POST', {
      bucket_name: 'report-images',
      object_key: objectKey,
    });

    const uploadUrl = urlRes.data?.upload_url;
    if (!uploadUrl) {
      throw new Error('Failed to get upload URL');
    }

    await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
    });

    await customApi('/api/v1/guest/save-image', 'POST', {
      report_id: reportId,
      object_key: objectKey,
      file_name: file.name,
    });

    return objectKey;
  };

  /** Whether the current user can pick a category when creating a report.
   * Guests and regular users skip the category field; their reports land in "بدون تصنيف". */
  const canPickCategory = hasPermission('change_report_category');

  /** Validate form fields before submission */
  const validateForm = (): boolean => {
    const canSkipDescription = hasPermission('view_all_reports');
    // Category (اختصاص القسم) and priority (نوع البلاغ) are OPTIONAL for ALL
    // users now. If left empty, the backend assigns "بدون تصنيف" and a
    // default priority so the report lands in the pending-classification view.
    if (
      !title.trim() ||
      (!canSkipDescription && !description.trim())
    ) {
      toast.error('يرجى ملء جميع الحقول المطلوبة');
      return false;
    }

    // Mosque name and region are required for all users
    if (!mosqueName) {
      toast.error('يرجى اختيار اسم المسجد');
      return false;
    }
    if (!region) {
      toast.error('يرجى اختيار المنطقة');
      return false;
    }

    // Validation patterns:
    // - Name: Arabic letters (\u0600-\u06FF\u0750-\u077F) + Latin letters + spaces only.
    //   No digits (Arabic-Indic ٠-٩ or Western 0-9), no symbols.
    // - Phone: digits + common phone symbols (+, -, (, ), space) only. No alpha.
    const NAME_PATTERN = /^[\u0600-\u06FF\u0750-\u077Fa-zA-Z\s]+$/;
    const PHONE_PATTERN = /^[0-9+\-\s()]+$/;

    // Guest users must provide reporter info
    if (isGuest) {
      if (!reporterName.trim()) {
        toast.error('يرجى إدخال اسم مقدم البلاغ');
        return false;
      }
      if (!NAME_PATTERN.test(reporterName.trim())) {
        toast.error('اسم مقدم البلاغ يجب أن يحتوي على حروف فقط (بدون أرقام)');
        return false;
      }
      if (!reporterPhone.trim()) {
        toast.error('يرجى إدخال رقم الجوال');
        return false;
      }
      if (!PHONE_PATTERN.test(reporterPhone.trim())) {
        toast.error('رقم الجوال يجب أن يحتوي على أرقام فقط (بدون حروف)');
        return false;
      }
      if (!reporterRole) {
        toast.error('يرجى اختيار صفة مقدم البلاغ');
        return false;
      }
    } else {
      // For authenticated users, validate optional fields if provided.
      if (reporterName.trim() && !NAME_PATTERN.test(reporterName.trim())) {
        toast.error('اسم مقدم البلاغ يجب أن يحتوي على حروف فقط (بدون أرقام)');
        return false;
      }
      if (reporterPhone.trim() && !PHONE_PATTERN.test(reporterPhone.trim())) {
        toast.error('رقم الجوال يجب أن يحتوي على أرقام فقط (بدون حروف)');
        return false;
      }
    }

    return true;
  };

  /** Actually submit the report with optional engineer assignment and contractor */
  const submitReport = async (assignSelf: boolean, executingEntity?: string) => {
    try {
      setSubmitting(true);

      const payload: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() || undefined,
        // Category and priority are optional for everyone. Only send them if
        // the user could pick them AND actually picked a value; otherwise the
        // backend will auto-assign "بدون تصنيف" and a default priority.
        category: canPickCategory && category ? category : undefined,
        // Always send a priority — when the user didn't pick one (or doesn't
        // have permission to pick), default to "بدون تصنيف" so the report is
        // explicitly tagged as pending-classification (matches backend default).
        priority: canPickCategory && priority ? priority : 'بدون تصنيف',
        status: 'open',
        reporter_name: reporterName.trim() || undefined,
        reporter_phone: reporterPhone.trim() || undefined,
        reporter_role: reporterRole || undefined,
        region: region || undefined,
        mosque_name: mosqueName || undefined,
      };

      // Add custom date if selected
      if (dateMode === 'custom' && customDate) {
        payload.created_at = new Date(customDate).toISOString();
      }

      // If user chose to assign themselves as engineer
      if (assignSelf && user) {
        payload.assigned_engineer = user.id;
        payload.assigned_engineer_name = user.username || user.email || 'مهندس';
      }

      // If a contractor/executing entity was selected
      if (executingEntity) {
        payload.executing_entity = executingEntity;
      }

      const reportRes = await customApi<{ id: number }>('/api/v1/reports-custom/create', 'POST', payload);

      const reportId = reportRes.data?.id;
      if (!reportId) {
        toast.error('فشل في إنشاء البلاغ');
        return;
      }

      // Upload files (images + PDFs)
      if (files.length > 0) {
        let uploadedCount = 0;
        for (const file of files) {
          try {
            await uploadFile(file, reportId);
            uploadedCount++;
          } catch (err) {
            console.error('Error uploading file:', err);
          }
        }
        if (uploadedCount > 0) {
          toast.success(`تم رفع ${uploadedCount} ملف بنجاح`);
        } else {
          toast.warning('تم إنشاء البلاغ لكن فشل رفع الملفات');
        }
      }

      toast.success('تم إنشاء البلاغ بنجاح!');

      if (isGuest) {
        navigate('/');
      } else {
        navigate(`/report/${reportId}`);
      }
    } catch (err) {
      console.error('Error creating report:', err);
      toast.error('فشل في إنشاء البلاغ');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    // For authenticated (non-guest) users, show engineer assignment confirmation
    if (!isGuest) {
      setDialogStep('engineer');
      setSelectedContractor('');
      setShowDialog(true);
      return;
    }

    // Guest users submit directly without engineer assignment
    await submitReport(false);
  };

  /** Handle choosing "Yes, I'm responsible" - go to contractor step */
  const handleYesEngineer = () => {
    setDialogStep('contractor');
    setSelectedContractor('');
  };

  /** Handle choosing "No, without engineer" - submit directly */
  const handleNoEngineer = async () => {
    setShowDialog(false);
    await submitReport(false);
  };

  /** Handle contractor selection and final submit */
  const handleContractorSubmit = async () => {
    setShowDialog(false);
    await submitReport(true, selectedContractor || undefined);
  };

  /** Close dialog and reset */
  const handleCloseDialog = () => {
    if (!submitting) {
      setShowDialog(false);
      setDialogStep('engineer');
      setSelectedContractor('');
    }
  };

  const handleLogin = () => {
    navigate('/login');
  };

  const handleLogout = async () => {
    await logout();
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-[#0b1527] flex items-center justify-center" dir="rtl">
        <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b1527]" dir="rtl">
      <Header user={user} onLogin={handleLogin} onLogout={handleLogout} />

      <main className="container mx-auto px-4 py-6 max-w-2xl">
        <Button
          variant="ghost"
          onClick={() => navigate('/')}
          className="mb-4 text-gray-600"
        >
          <ArrowRight className="h-4 w-4 ml-1" />
          <EditableText textKey="create.back_btn" defaultText="العودة للرئيسية" as="span" />
        </Button>

        {/* Guest Announcement Banner */}
        {isGuest && guestAnnouncement && (
          <div className="mb-4 bg-teal-50 border border-teal-200 rounded-lg p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="bg-teal-100 rounded-full p-2 flex-shrink-0">
                <Megaphone className="h-5 w-5 text-teal-600" />
              </div>
              <div className="flex-1 min-w-0">
                <EditableText
                  textKey="create.announcement_label"
                  defaultText="إعلان"
                  as="p"
                  className="text-sm font-semibold text-teal-800 mb-1"
                />
                <p className="text-sm text-teal-700 leading-relaxed whitespace-pre-wrap">{guestAnnouncement.message}</p>
              </div>
            </div>
          </div>
        )}

        <Card>
          <CardHeader>
            <EditableText
              textKey="create.title"
              defaultText="إنشاء بلاغ جديد"
              as="div"
              className="text-xl font-semibold leading-none tracking-tight"
            />
            {isGuest && (
              <EditableText
                textKey="create.guest_notice"
                defaultText="أنت تنشئ بلاغ كضيف. يمكنك إرفاق صور وملفات PDF مع البلاغ. وسيتم متابعة البلاغ من المهندس المختص"
                as="p"
                className="text-sm text-amber-600 bg-amber-50 p-2 rounded-lg mt-2"
                multiline
              />
            )}
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Reporter Info Section */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-4">
                <h3 className="text-sm font-semibold text-blue-800 flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <EditableText textKey="create.reporter_section_title" defaultText="معلومات مقدم البلاغ" as="span" />
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="reporterName">
                      <EditableText textKey="create.reporter_name_label" defaultText="الاسم" as="span" />
                      {isGuest && <span className="text-red-500 mr-1">*</span>}
                    </Label>
                    <Input
                      id="reporterName"
                      placeholder="أدخل اسمك"
                      value={reporterName}
                      onChange={(e) => {
                        // Strip ANY digit (Western 0-9 or Arabic-Indic ٠-٩) in real time.
                        const cleaned = e.target.value.replace(/[0-9\u0660-\u0669\u06F0-\u06F9]/g, '');
                        setReporterName(cleaned);
                      }}
                      required={isGuest}
                    />
                    <p className="text-xs text-gray-500">حروف فقط (بدون أرقام)</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reporterPhone">
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        <EditableText textKey="create.reporter_phone_label" defaultText="رقم الجوال" as="span" />
                        {isGuest && <span className="text-red-500 mr-1">*</span>}
                      </span>
                    </Label>
                    <Input
                      id="reporterPhone"
                      type="tel"
                      inputMode="tel"
                      placeholder="05xxxxxxxx"
                      value={reporterPhone}
                      onChange={(e) => {
                        // Allow digits + common phone symbols (+, -, (, ), space).
                        // Strip any letter (Latin or Arabic) in real time.
                        const val = e.target.value.replace(/[^\d+\-\s()]/g, '');
                        setReporterPhone(val);
                      }}
                      dir="ltr"
                      className="text-right"
                    />
                    <p className="text-xs text-gray-500">أرقام فقط (بدون حروف)</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>
                    <EditableText textKey="create.reporter_role_label" defaultText="الصفة" as="span" />
                    {isGuest && <span className="text-red-500 mr-1">*</span>}
                  </Label>
                  <Select value={reporterRole} onValueChange={setReporterRole}>
                    <SelectTrigger>
                      <SelectValue placeholder="اختر صفتك" />
                    </SelectTrigger>
                    <SelectContent>
                      {REPORTER_ROLE_OPTIONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Location Info Section */}
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-4">
                <h3 className="text-sm font-semibold text-green-800 flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  <EditableText textKey="create.location_section_title" defaultText="معلومات الموقع" as="span" />
                </h3>

                <div className="space-y-4">
                  {/* Mosque quick search (auto-fills region) */}
                  <div className="space-y-2">
                    <Label>
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3 w-3" />
                        <EditableText textKey="create.mosque_label" defaultText="اسم المسجد *" as="span" />
                      </span>
                    </Label>
                    <Combobox
                      options={globalMosqueOptions}
                      value={currentGlobalMosqueValue}
                      onValueChange={handleGlobalMosqueChange}
                      placeholder={
                        loadingLocations
                          ? 'جاري التحميل...'
                          : region
                            ? selectedRegionData && selectedRegionData.mosques.length > 0
                              ? `اختر مسجداً في ${region}...`
                              : 'لا توجد مساجد في هذه المنطقة'
                            : 'ابحث باسم المسجد مباشرةً...'
                      }
                      searchPlaceholder="اكتب اسم المسجد..."
                      emptyText="لا توجد نتائج"
                    />
                    <p className="text-xs text-gray-500">
                      {region
                        ? `🕌 يتم عرض مساجد منطقة ${region} فقط`
                        : '💡 اكتب اسم المسجد وسيتم اختيار المنطقة تلقائياً'}
                    </p>
                  </div>

                  {/* Region (auto-filled from mosque, but can be changed to filter) */}
                  <div className="space-y-2">
                    <Label>
                      <EditableText textKey="create.region_label" defaultText="المنطقة *" as="span" />
                    </Label>
                    <Select
                      value={region}
                      onValueChange={handleRegionChange}
                      disabled={loadingLocations}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={loadingLocations ? 'جاري التحميل...' : 'اختر المنطقة'} />
                      </SelectTrigger>
                      <SelectContent>
                        {regionsData.map((r) => (
                          <SelectItem key={r.id} value={r.name}>
                            {r.name} ({r.mosques.length} مسجد)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {region && selectedRegionData && (
                      <p className="text-xs text-gray-500">
                        {selectedRegionData.mosques.length} مسجد في {region}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="title">
                  <EditableText textKey="create.report_title_label" defaultText="عنوان البلاغ *" as="span" />
                </Label>
                <Input
                  id="title"
                  placeholder="أدخل عنوان البلاغ"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">
                  <EditableText
                    textKey="create.description_label"
                    defaultText={hasPermission('view_all_reports') ? 'الوصف (اختياري)' : 'الوصف *'}
                    as="span"
                  />
                </Label>
                <Textarea
                  id="description"
                  placeholder="اوصف المشكلة بالتفصيل..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  required={!hasPermission('view_all_reports')}
                />
              </div>

              <div className={canPickCategory ? 'grid grid-cols-2 gap-4' : 'space-y-2'}>
                {canPickCategory && (
                  <div className="space-y-2">
                    <Label>
                      <EditableText textKey="create.category_label" defaultText="اختصاص قسم" as="span" />
                    </Label>
                    <Select
                      value={category || '__none__'}
                      onValueChange={(v) => setCategory(v === '__none__' ? '' : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="اختر القسم (اختياري)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— بدون —</SelectItem>
                        {categoryOptions.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {canPickCategory && (
                  <div className="space-y-2">
                    <Label>
                      <EditableText textKey="create.priority_label" defaultText="مستوى الاهمية" as="span" />
                    </Label>
                    <Select
                      value={priority || '__none__'}
                      onValueChange={(v) => setPriority(v === '__none__' ? '' : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="اختر نوع البلاغ (اختياري)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— بدون —</SelectItem>
                        {priorityOptions.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Date Selection */}
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-semibold text-purple-800 flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  تاريخ البلاغ
                </h3>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="dateMode"
                      value="today"
                      checked={dateMode === 'today'}
                      onChange={() => { setDateMode('today'); setCustomDate(''); }}
                      className="accent-purple-600"
                    />
                    <span className="text-sm text-gray-700">تاريخ اليوم</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="dateMode"
                      value="custom"
                      checked={dateMode === 'custom'}
                      onChange={() => setDateMode('custom')}
                      className="accent-purple-600"
                    />
                    <span className="text-sm text-gray-700">تاريخ آخر</span>
                  </label>
                </div>
                {dateMode === 'custom' && (
                  <Input
                    type="date"
                    value={customDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                    className="max-w-xs"
                    dir="ltr"
                  />
                )}
              </div>

              {/* File Upload (Images + PDFs) */}
              <div className="space-y-2">
                <Label>
                  <EditableText textKey="create.attachments_label" defaultText="مرفقات البلاغ - صور أو PDF (حد أقصى 5)" as="span" />
                </Label>
                <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
                  <input
                    type="file"
                    accept={ACCEPTED_FILE_TYPES}
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload" className="cursor-pointer">
                    <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                    <EditableText
                      textKey="create.upload_prompt"
                      defaultText="اضغط لرفع الصور أو ملفات PDF"
                      as="p"
                      className="text-sm text-gray-500"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      PNG, JPG, GIF, PDF حتى 10MB لكل ملف
                    </p>
                  </label>
                </div>

                {previews.length > 0 && (
                  <div className="grid grid-cols-3 gap-3 mt-3">
                    {previews.map((preview, index) => (
                      <div key={index} className="relative group">
                        {preview.type === 'pdf' ? (
                          <div className="h-24 w-full bg-red-50 border border-red-200 rounded-lg flex flex-col items-center justify-center gap-1">
                            <FileText className="h-8 w-8 text-red-500" />
                            <span className="text-[10px] text-red-600 font-medium">PDF</span>
                          </div>
                        ) : (
                          <img
                            src={preview.url}
                            alt={`معاينة ${index + 1}`}
                            className="h-24 w-full object-cover rounded-lg border"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => removeFile(index)}
                          className="absolute -top-2 -left-2 h-6 w-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-3 w-3" />
                        </button>
                        <p className="text-xs text-gray-500 mt-1 truncate">
                          {preview.name}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Button
                type="submit"
                disabled={submitting}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5"
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                    <EditableText textKey="create.submitting_btn" defaultText="جاري إنشاء البلاغ..." as="span" />
                  </span>
                ) : (
                  <EditableText textKey="create.submit_btn" defaultText="إنشاء البلاغ" as="span" />
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>

      {/* Engineer Assignment & Contractor Confirmation Dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) handleCloseDialog(); }}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          {/* Step 1: Engineer Assignment */}
          {dialogStep === 'engineer' && (
            <>
              <DialogHeader>
                <DialogTitle className="text-right text-lg">
                  تعيين المهندس المسؤول
                </DialogTitle>
                <DialogDescription className="text-right text-sm leading-relaxed mt-2">
                  هل أنت المهندس المسؤول عن هذا البلاغ؟ سيتم تعيينك تلقائياً كمهندس مسؤول إذا اخترت "نعم".
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-3 mt-4">
                <Button
                  onClick={handleYesEngineer}
                  disabled={submitting}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-2 py-3"
                >
                  <UserCheck className="h-5 w-5" />
                  نعم، أنا المسؤول
                  <ChevronRight className="h-4 w-4 mr-auto rotate-180" />
                </Button>

                <Button
                  variant="outline"
                  onClick={handleNoEngineer}
                  disabled={submitting}
                  className="w-full gap-2 py-3"
                >
                  {submitting ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-spin h-4 w-4 border-2 border-gray-500 border-t-transparent rounded-full" />
                      جاري الإنشاء...
                    </span>
                  ) : (
                    <>
                      <UserX className="h-5 w-5" />
                      لا، بدون تعيين مهندس
                    </>
                  )}
                </Button>
              </div>

              <DialogFooter className="mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCloseDialog}
                  disabled={submitting}
                  className="w-full text-gray-500"
                >
                  إلغاء
                </Button>
              </DialogFooter>
            </>
          )}

          {/* Step 2: Contractor / Executing Entity Selection */}
          {dialogStep === 'contractor' && (
            <>
              <DialogHeader>
                <DialogTitle className="text-right text-lg flex items-center gap-2">
                  <Wrench className="h-5 w-5 text-blue-600" />
                  الجهة المنفذة / المقاول
                </DialogTitle>
                <DialogDescription className="text-right text-sm leading-relaxed mt-2">
                  اختر الجهة المنفذة أو المقاول الذي سيقوم بتنفيذ العمل المطلوب في هذا البلاغ.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 space-y-4">
                {contractorsLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <span className="animate-spin h-6 w-6 border-3 border-blue-600 border-t-transparent rounded-full" />
                    <span className="mr-2 text-sm text-gray-500">جاري تحميل المقاولين...</span>
                  </div>
                ) : contractors.length > 0 ? (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">اختر الجهة المنفذة / المقاول</Label>
                    <Select value={selectedContractor || '__none__'} onValueChange={(val) => setSelectedContractor(val === '__none__' ? '' : val)}>
                      <SelectTrigger>
                        <SelectValue placeholder="اختر المقاول" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">-- بدون تحديد --</SelectItem>
                        {contractors.map((c) => (
                          <SelectItem key={c.id} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="text-center py-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <Wrench className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">لا يوجد مقاولين مسجلين حالياً.</p>
                    <p className="text-xs text-gray-400 mt-1">يمكنك إضافة مقاولين من لوحة الإدارة.</p>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <Button
                    onClick={handleContractorSubmit}
                    disabled={submitting}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white gap-2"
                  >
                    {submitting ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                        جاري الإنشاء...
                      </span>
                    ) : (
                      'إنشاء البلاغ'
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setDialogStep('engineer')}
                    disabled={submitting}
                    className="gap-1"
                  >
                    <ArrowRight className="h-4 w-4" />
                    رجوع
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}