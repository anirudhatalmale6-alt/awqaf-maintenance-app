import { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  ArrowRight,
  UserPlus,
  LogIn,
  FilePlus,
  Search,
  Bell,
  MessageCircle,
  Users,
  UserCog,
  KeyRound,
  FileText,
  Eye,
  Printer,
  Download,
  Wrench,
  CheckCircle2,
  ShieldCheck,
  ClipboardList,
  Settings,
  Info,
  HelpCircle,
  Home,
  Pencil,
  Save,
  X,
  Plus,
  Trash2,
  RotateCcw,
  Loader2,
  Sparkles,
  Wand2,
  Bug,
  Calendar,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import Header from '@/components/Header';
import { useAuth } from '@/lib/AuthContext';
import {
  useUserGuideContent,
  useUpdateUserGuideContent,
  useMarkChangelogSeen,
  type UserGuideContent,
  type GuideFAQ,
  type GuideChangelogEntry,
} from '@/lib/useUserGuide';

/* ===========================================================================
   🔒 AUTO-UPDATE CONTRACT
   ---------------------------------------------------------------------------
   Whenever Alex ships a new feature or changes a user-facing workflow in this
   project, TWO things must happen IN CODE (not the DB):

     1. Update the relevant DEFAULTS entry below (steps list / intro / items).
     2. Prepend a new item to CHANGELOG at the top of the list.

   Because `mergeContent` only overrides keys explicitly saved by the admin,
   untouched sections automatically pick up the latest DEFAULTS — so the guide
   keeps itself in sync without any manual action. Admins can still customize
   the text; their overrides win, but fields they never touched always follow
   the latest code-shipped content.
   =========================================================================== */

/* ---------- Feature flags: hide sections a given viewer cannot use ------- */

type Role = 'admin' | 'owner' | 'engineer' | 'user' | 'guest';

interface SectionMeta {
  id: string;
  title: string;
  icon: React.ElementType;
  badge?: string;
  /** Roles allowed to see this section. Empty = everyone. */
  roles?: Role[];
}

const SECTIONS: SectionMeta[] = [
  { id: 'intro', title: 'مقدمة', icon: Info },
  { id: 'changelog', title: 'آخر التحديثات', icon: Sparkles },
  { id: 'roles', title: 'أنواع المستخدمين', icon: ShieldCheck },
  { id: 'register', title: 'إنشاء حساب جديد', icon: UserPlus, roles: ['guest'] },
  { id: 'login', title: 'تسجيل الدخول', icon: LogIn, roles: ['guest'] },
  { id: 'create-report', title: 'إنشاء بلاغ صيانة', icon: FilePlus },
  { id: 'track-reports', title: 'متابعة البلاغات', icon: Search, roles: ['user', 'engineer', 'admin', 'owner'] },
  { id: 'report-detail', title: 'تفاصيل البلاغ', icon: FileText, roles: ['user', 'engineer', 'admin', 'owner'] },
  { id: 'notifications', title: 'الإشعارات', icon: Bell, roles: ['user', 'engineer', 'admin', 'owner'] },
  { id: 'messages', title: 'المراسلات', icon: MessageCircle, roles: ['user', 'engineer', 'admin', 'owner'] },
  { id: 'online-users', title: 'المستخدمون المتصلون', icon: Users, roles: ['user', 'engineer', 'admin', 'owner'] },
  { id: 'engineer', title: 'للمهندسين', icon: Wrench, badge: 'مهندس', roles: ['engineer', 'admin', 'owner'] },
  // "Contracts" module is a logged-in feature — visible to all registered users
  // (regular users, engineers, admins, owners) but hidden from guests.
  { id: 'contracts', title: 'العقود وأوامر العمل', icon: ClipboardList, roles: ['user', 'engineer', 'admin', 'owner'] },
  { id: 'admin', title: 'لوحة الإدارة', icon: UserCog, badge: 'مدير', roles: ['admin', 'owner'] },
  { id: 'export-print', title: 'الطباعة والتصدير', icon: Printer },
  { id: 'security', title: 'الأمان والخصوصية', icon: KeyRound },
  { id: 'faq', title: 'أسئلة شائعة', icon: HelpCircle },
];

function isSectionVisible(section: SectionMeta, role: Role, editMode: boolean): boolean {
  if (editMode) return true;
  if (!section.roles || section.roles.length === 0) return true;
  return section.roles.includes(role);
}

/* ---------- Built-in, code-shipped changelog (most recent first) --------- */

const BUILT_IN_CHANGELOG: GuideChangelogEntry[] = [
  {
    date: '2026-04-27',
    type: 'improvement',
    title: 'عرض "المهندس المسؤول" افتراضياً في جدول البلاغات',
    description:
      'تم تغيير الأعمدة الافتراضية في الصفحة الرئيسية بحيث يظهر عمود "المهندس المسؤول" بدلاً من "مقدم البلاغ" ليكون أكثر فائدة في المتابعة اليومية. يمكن دائماً تخصيص الأعمدة يدوياً من إعدادات الجدول.',
  },
  {
    date: '2026-04-27',
    type: 'feature',
    title: 'خيار إخفاء عمود التاريخ في الطباعة والتصدير',
    description:
      'أضيف خيار جديد في نافذتي الطباعة وتصدير البلاغات (Excel/Word) للتحكم في إظهار أو إخفاء عمود التاريخ، بنفس أسلوب بقية الخيارات الموجودة (مقدم البلاغ، المهندس، الجهة، المنطقة، نوع الإصلاح).',
  },
  {
    date: '2026-04-27',
    type: 'improvement',
    title: 'حذف الأصفار الزائدة من التكاليف',
    description:
      'تم تنسيق عرض المبالغ المالية في صفحات العقود وأوامر العمل لإزالة الأصفار الزائدة بعد الفاصلة العشرية (مثلاً: 1,500 د.ك بدلاً من 1,500.00 د.ك) عندما لا تكون هناك كسور فعلية.',
  },
  {
    date: '2026-04-27',
    type: 'improvement',
    title: 'ترتيب أفضل لصفحة تفاصيل البلاغ',
    description:
      'تم نقل قسم "معلومات الموقع" ليظهر قبل "معلومات مقدم البلاغ" في صفحة تفاصيل البلاغ، لعرض أهم المعلومات التشغيلية أولاً.',
  },
  {
    date: '2026-04-27',
    type: 'improvement',
    title: 'تحسين وضوح صفحة تفاصيل العقد في الوضع الداكن',
    description:
      'تم تحسين ألوان وتباين التواريخ والتكاليف في صفحة تفاصيل العقد لضمان وضوحها بالكامل في الوضع الداكن.',
  },
  {
    date: '2026-04-26',
    type: 'improvement',
    title: 'إزالة مؤشر التحميل أثناء التحديثات',
    description:
      'تم تحسين تجربة المستخدم في الصفحة الرئيسية بإزالة مؤشر التحميل المتكرر الذي كان يظهر أثناء تحديث البيانات في الخلفية، بحيث لم يعد يظهر إلا عند التحميل الأول فقط.',
  },
  {
    date: '2026-04-26',
    type: 'improvement',
    title: 'توحيد التواريخ بالتقويم الميلادي',
    description:
      'تم توحيد عرض جميع التواريخ في الموقع بالتقويم الميلادي (بالأرقام الإنجليزية) على أجهزة الكمبيوتر والهواتف معاً، لتجنّب ظهور بعض التواريخ بالتقويم الهجري على أجهزة معينة.',
  },
  {
    date: '2026-04-25',
    type: 'feature',
    title: 'إدارة العقود وأوامر العمل',
    description:
      'تمت إضافة قسم "العقود" لإدارة عقود الصيانة وأوامر العمل المرتبطة بها، مع إمكانية تتبّع المصاميم والخطط، وتوزيع الميزانيات على السنوات المالية، وتعيين المهندسين المسؤولين عن كل أمر عمل.',
  },
  {
    date: '2026-04-25',
    type: 'feature',
    title: 'تبويب المصاميم والسنوات المالية',
    description:
      'أصبح بإمكان الإدارة متابعة المصاميم والمخططات ضمن كل عقد، وإدارة تخصيصات الميزانية لكل سنة مالية بشكل منظّم من داخل صفحة تفاصيل العقد.',
  },
  {
    date: '2026-04-24',
    type: 'feature',
    title: 'اقتراحات المستخدمين',
    description:
      'يمكن للزوار والمستخدمين إرسال اقتراحاتهم حول الموقع مباشرة عبر نافذة مخصصة، وتظهر هذه الاقتراحات للمدير في تبويب جديد داخل لوحة الإدارة للمراجعة والمتابعة.',
  },
  {
    date: '2026-04-24',
    type: 'feature',
    title: 'إنشاء المستخدمين بالجملة',
    description:
      'تمت إضافة نافذة جديدة في لوحة الإدارة تسمح للمدير برفع ملف يحتوي على بيانات عدة مستخدمين، وإنشاء حساباتهم دفعة واحدة مع تعيين أدوارهم وصلاحياتهم.',
  },
  {
    date: '2026-04-24',
    type: 'feature',
    title: 'اختيار المواقع/المساجد بالبحث الذكي',
    description:
      'عند إنشاء بلاغ، تم استبدال القائمة التقليدية بمكوّن بحث ذكي يسمح بكتابة اسم أو رقم الموقع والوصول إليه فوراً بدون تمرير طويل.',
  },
  {
    date: '2026-04-23',
    type: 'feature',
    title: 'تعيين مهندسين متعددين',
    description:
      'أصبح بإمكان الإدارة اختيار أكثر من مهندس مسؤول لأمر العمل أو البلاغ الواحد، مع عرض أسماء المهندسين مباشرة في صفحة تفاصيل العقد والبلاغ.',
  },
  {
    date: '2026-04-23',
    type: 'feature',
    title: 'تصنيفات تفصيلية لأوامر العمل',
    description:
      'تمت إضافة حقل "توزيع التصنيفات" لأوامر العمل، ممّا يتيح تفصيل التكاليف والمهام حسب كل تصنيف (كهرباء، سباكة، تكييف...) داخل نفس أمر العمل.',
  },
  {
    date: '2026-04-23',
    type: 'feature',
    title: 'تصدير المستخدمين إلى Excel',
    description:
      'تمت إضافة زر جديد في لوحة الإدارة لتصدير قائمة المستخدمين مع بياناتهم كاملةً إلى ملف Excel لسهولة المراجعة والأرشفة.',
  },
  {
    date: '2026-04-23',
    type: 'feature',
    title: 'إعلانات للزوار في الصفحة الرئيسية',
    description:
      'أصبح بإمكان الإدارة نشر إعلانات تظهر لزوار الصفحة الرئيسية قبل تسجيل الدخول، لإيصال رسائل هامّة لجميع المستخدمين.',
  },
  {
    date: '2026-04-22',
    type: 'feature',
    title: 'نظام التغييرات (Changelog)',
    description:
      'تمت إضافة نظام تتبّع تحديثات لكل مستخدم على حدة، مع مؤشّر بصري (نقطة حمراء) بجانب رابط الدليل يخبر المستخدم بوجود تحديثات جديدة لم يطّلع عليها بعد.',
  },
  {
    date: '2026-04-22',
    type: 'feature',
    title: 'بحث فوري داخل دليل الاستخدام',
    description:
      'تمت إضافة شريط بحث في أعلى الصفحة يُبرز الكلمات المطابقة فوراً ويقفز إلى أول نتيجة مع أزرار للانتقال بين النتائج.',
  },
  {
    date: '2026-04-22',
    type: 'feature',
    title: 'تحديث تلقائي لصفحة دليل الاستخدام',
    description:
      'أصبح الدليل يتحدّث تلقائياً عند إضافة ميزات جديدة، مع قسم "آخر التحديثات"، وزر لاستعادة المحتوى الافتراضي لكل قسم، وعرض الأقسام حسب صلاحيات المستخدم.',
  },
  {
    date: '2026-04-22',
    type: 'feature',
    title: 'دليل الاستخدام قابل للتعديل',
    description:
      'يمكن للمدير والمالك الآن تعديل نصوص دليل الاستخدام مباشرة من الصفحة عبر زر "تعديل الدليل"، وتُحفظ التغييرات في قاعدة البيانات لتظهر لجميع الزوار فوراً.',
  },
  {
    date: '2026-04-22',
    type: 'feature',
    title: 'إعدادات الهوية البصرية',
    description:
      'تبويب جديد في لوحة الإدارة يسمح بتغيير اسم الموقع ووصفه وشعاره، وتنعكس التغييرات فوراً على جميع الصفحات بما فيها عنوان التبويب.',
  },
  {
    date: '2026-04-21',
    type: 'feature',
    title: 'المستخدمون المتصلون',
    description:
      'تمت إضافة زر وقائمة تعرض المستخدمين النشطين حالياً مع تحديث تلقائي عبر WebSocket وعدّاد مباشر.',
  },
  {
    date: '2026-04-20',
    type: 'improvement',
    title: 'تحسينات التصدير والطباعة',
    description:
      'إضافة تصدير Excel وWord للبلاغات وتقرير المساجد المتكررة، مع تنسيق طباعة محسّن للصور والمرفقات.',
  },
  {
    date: '2026-04-18',
    type: 'feature',
    title: 'إنشاء البلاغات بالجملة',
    description:
      'يمكن للمديرين رفع ملف يحتوي على عدة بلاغات ليتم إنشاؤها دفعة واحدة مع تعيين المهندس المسؤول.',
  },
];

/** Built-in defaults — used when no override is stored in the DB. */
const DEFAULTS: Required<Omit<UserGuideContent, 'faqs' | 'changelog'>> & {
  faqs: GuideFAQ[];
  changelog: GuideChangelogEntry[];
} = {
  hero_title: 'دليل استخدام الموقع',
  hero_subtitle: 'شرح كامل لجميع المميزات وكيفية الاستفادة منها',

  intro_paragraphs: [
    'مرحباً بك في نظام بلاغات الصيانة. هذا النظام مصمم لتسهيل عملية تقديم بلاغات الصيانة ومتابعتها بين المستخدمين والمهندسين والإدارة بشكل سريع ومنظّم.',
    'يوفر النظام تجربة استخدام بسيطة من تقديم البلاغ وحتى متابعة الإصلاح، مع إشعارات فورية ومراسلات مباشرة ولوحات إدارية متقدمة.',
    'يتم تحديث هذا الدليل تلقائياً كلما تمت إضافة ميزة جديدة أو تحديث ميزة قائمة، بحيث تبقى دائماً على اطلاع بآخر الإمكانيات المتاحة.',
  ],
  roles_intro: 'يدعم النظام أدواراً مختلفة لكل منها صلاحيات مخصصة:',

  track_intro:
    'من الصفحة الرئيسية يمكنك عرض جميع بلاغاتك (أو جميع بلاغات النظام إذا كانت لديك الصلاحية) مع أدوات متقدمة:',
  track_items: [
    'فلاتر بحث متعددة: الحالة، الأولوية، التصنيف، المهندس المسؤول، المُقدِّم.',
    'البحث النصي السريع في العناوين والأوصاف.',
    'خيارات عرض الأعمدة والتحكم فيها حسب احتياجك.',
    'ترتيب البلاغات حسب التاريخ، الأولوية، أو الحالة.',
    'عرض البلاغات المتكررة لنفس الموقع لتسهيل التشخيص.',
  ],

  report_detail_intro: 'عند فتح بلاغ تظهر لك صفحة تفاصيل شاملة تحتوي على:',
  report_detail_tip:
    'يمكن للمستخدمين المعنيين إضافة ملاحظات وردود ومرفقات إضافية أثناء معالجة البلاغ، وكل تحديث يولّد إشعاراً للأطراف ذات العلاقة.',

  notifications_intro:
    'يظهر جرس الإشعارات في أعلى الصفحة مع عدّاد للإشعارات غير المقروءة. عند النقر عليه تظهر قائمة مختصرة بآخر الأحداث.',
  notifications_items: [
    'تحديث فوري عبر اتصال مباشر (WebSocket) بدون إعادة تحميل.',
    'نقطة خضراء بجانب الجرس تدل على الاتصال المباشر.',
    'يمكن فتح الإشعار في تبويب جديد بالضغط مع مفتاح Ctrl/Cmd.',
    'تصفية الإشعارات وتمييزها كمقروءة.',
  ],

  messages_intro: 'نظام المراسلات يتيح التواصل المباشر بين المستخدمين داخل الموقع:',
  messages_items: [
    'محادثات ثنائية مع أي مستخدم نشط.',
    'إشعارات للرسائل الجديدة غير المقروءة.',
    'حذف الرسائل بعد تأكيد (للمستخدمين المعنيين).',
    'رؤية المستخدمين المتصلين حالياً للتواصل السريع.',
  ],

  online_users_intro:
    'زر المستخدمون المتصلون في أعلى الصفحة يعرض قائمة المستخدمين النشطين حالياً مع أدوارهم.',
  online_users_items: [
    'النقطة الخضراء تدل على الاتصال المباشر للمستخدم.',
    'يتم تحديث القائمة تلقائياً كل بضع ثوانٍ.',
    'عدّاد بجانب الزر يُظهر عدد المتصلين حالياً.',
  ],

  engineer_intro: 'واجهة مخصصة للمهندسين لتسهيل إنجاز أعمال الصيانة:',
  engineer_tip:
    'لوحة الإحصائيات تعرض أداءك (عدد البلاغات المكتملة، متوسط وقت الاستجابة، التوزيع حسب التصنيف).',

  contracts_intro:
    'قسم "العقود" يتيح متابعة عقود الصيانة مع الشركات المنفذة، وتنظيم أوامر العمل والمصاميم والسنوات المالية المرتبطة بكل عقد.',
  contracts_steps: [
    'انقر على رابط "العقود" من القائمة العلوية للوصول إلى صفحة قائمة العقود.',
    'تعرض الصفحة جميع العقود مع بياناتها الأساسية: الرقم، الشركة، تاريخ البداية والنهاية، والتكلفة الإجمالية.',
    'استخدم شريط البحث والفلاتر لإيجاد عقد معيّن بسرعة.',
    'اضغط على أي عقد لفتح صفحة تفاصيله الكاملة.',
    'داخل صفحة العقد ستجد تبويبات: أوامر العمل، المصاميم، السنوات المالية (توزيع الميزانية).',
    'في تبويب "أوامر العمل" يمكنك إضافة أمر عمل جديد أو فتح أمر موجود لعرض تفاصيله والمهندسين المسؤولين عنه وتوزيع التصنيفات (كهرباء، سباكة، تكييف...).',
    'في تبويب "المصاميم" يمكن تتبّع المخططات والمصاميم المرتبطة بأوامر العمل ومتابعة حالتها.',
    'في تبويب "السنوات المالية" تظهر ميزانية العقد موزّعة على السنوات، مع إمكانية تحديث المبالغ المخصصة لكل سنة.',
  ],
  contracts_items: [
    'عرض قائمة كاملة بجميع العقود مع تواريخها وتكاليفها الإجمالية.',
    'فتح تفاصيل كل عقد بنقرة واحدة ورؤية جميع أوامر العمل التابعة له.',
    'إضافة أوامر عمل وربطها بمهندسين متعددين مسؤولين عنها.',
    'توزيع تكلفة أمر العمل على تصنيفات فرعية (كهرباء، سباكة، تكييف، مدني...).',
    'إدارة المصاميم والخطط الهندسية داخل كل عقد ومتابعة حالة كل مصمم.',
    'توزيع ميزانية العقد على السنوات المالية لتسهيل المراجعة المحاسبية.',
    'ظهور "المهندس المسؤول" مباشرة داخل صفحة العقد بدون الحاجة لفتح أمر العمل.',
  ],
  contracts_tip:
    'إمكانية إضافة أو تعديل العقود وأوامر العمل متاحة لأصحاب الصلاحية فقط (عادةً الإدارة)، لكن يمكن لبقية المستخدمين عرض العقود ومتابعة حالتها للاطلاع على الخطط الجارية.',

  admin_intro: 'من زر لوحة الإدارة تصل إلى جميع أدوات التحكم:',
  admin_tip:
    'تخصيص الهوية البصرية: من تبويب إعدادات الموقع يمكنك تغيير اسم الموقع ووصفه وشعاره بشكل فوري على جميع الصفحات.',

  export_intro: 'النظام يدعم عدة صيغ لإخراج البيانات:',
  export_items: [
    'طباعة البلاغ: نسخة مصمّمة خصيصاً للطباعة تشمل المرفقات.',
    'تصدير Excel: تصدير قائمة البلاغات كملف .xlsx للتحليل.',
    'تصدير Word: تصدير كملف .docx قابل للتحرير.',
    'تقرير المساجد المتكررة: تقرير إحصائي بالمواقع الأكثر بلاغات.',
  ],

  security_items: [
    'كلمات المرور مُشفّرة بشكل آمن ولا يمكن لأحد استعراضها.',
    'كل مستخدم يرى فقط ما تسمح به صلاحياته.',
    'يمكنك تغيير كلمة المرور في أي وقت من أيقونة المفتاح في الأعلى.',
    'تسجيل الخروج ينهي الجلسة فوراً على جميع الأجهزة.',
    'الحسابات الجديدة تحتاج موافقة إدارية لمنع الحسابات الوهمية.',
  ],

  register_steps: [
    'انقر على زر "تسجيل الدخول" في الأعلى ثم اختر "إنشاء حساب جديد".',
    'أدخل بياناتك (الاسم، البريد الإلكتروني، كلمة مرور قوية).',
    'أرسل طلب التسجيل وانتظر مراجعته من قبل الإدارة.',
    'عند الموافقة، ستتمكن من تسجيل الدخول واستخدام جميع ميزات حسابك.',
  ],
  login_steps: [
    'انقر على "تسجيل الدخول" في أعلى الصفحة.',
    'أدخل البريد الإلكتروني (أو اسم المستخدم) وكلمة المرور.',
    'بعد الدخول، ستظهر لوحتك الشخصية مع جميع الأدوات المتاحة وفق صلاحياتك.',
  ],
  create_report_steps: [
    'انقر على زر "بلاغ جديد" في أعلى الصفحة.',
    'اختر الموقع (المسجد/المبنى) من قائمة البحث الذكي.',
    'حدّد التصنيف (كهرباء، سباكة، تكييف...) والأولوية.',
    'اكتب عنواناً وصفياً ووصفاً مفصلاً للمشكلة.',
    'أرفق الصور أو الملفات التي توضح المشكلة (اختياري).',
    'اضغط "إرسال البلاغ" وسيتم إشعار الإدارة والمهندسين المعنيين.',
  ],
  engineer_steps: [
    'استعرض البلاغات المعينة لك من الصفحة الرئيسية.',
    'افتح البلاغ لقراءة التفاصيل والمرفقات.',
    'حدّث الحالة (قيد التنفيذ، مكتمل، يحتاج قطع غيار...).',
    'أضف ملاحظات فنية وصور توثق الإصلاح.',
    'عند الانتهاء، أغلق البلاغ وسيصل إشعار للمُبلِّغ.',
  ],

  register_tip:
    'الحسابات الجديدة تحتاج إلى موافقة المدير قبل التفعيل. سيتم إعلامك عند الموافقة على حسابك.',
  login_tip:
    'نسيت كلمة المرور؟ استخدم رابط استعادة كلمة المرور أو تواصل مع الإدارة. يمكنك لاحقاً تغيير كلمة المرور من أيقونة المفتاح في الأعلى.',

  faqs: [
    {
      q: 'هل يمكنني تقديم بلاغ بدون تسجيل؟',
      a: "نعم، يمكن للزوار تقديم بلاغ من زر 'بلاغ جديد' مباشرة، لكن تسجيل الحساب يتيح متابعة البلاغات لاحقاً.",
    },
    {
      q: 'كيف أعرف أن بلاغي قيد المعالجة؟',
      a: 'ستصلك إشعارات عند كل تحديث في حالة البلاغ (تعيين مهندس، بدء العمل، الاكتمال)، ويمكنك متابعة الحالة من صفحة البلاغات.',
    },
    {
      q: 'ماذا أفعل إذا نسيت كلمة المرور؟',
      a: 'تواصل مع الإدارة لإعادة تعيينها، أو استخدم ميزة استعادة كلمة المرور إذا كانت مفعّلة.',
    },
    {
      q: 'هل يعمل الموقع على الهاتف؟',
      a: 'نعم، التصميم متجاوب بالكامل ويعمل على جميع الأجهزة، ويمكن تثبيته كتطبيق PWA من المتصفح.',
    },
    {
      q: 'لماذا لا أستطيع رؤية لوحة الإدارة؟',
      a: 'لوحة الإدارة متاحة فقط للمستخدمين الذين يملكون صلاحية الوصول إليها. تواصل مع المدير لمنحك الصلاحية.',
    },
    {
      q: 'كيف يتم تحديث هذا الدليل؟',
      a: 'يتم تحديث الدليل تلقائياً من الكود عند إضافة ميزات جديدة، ويمكن للمدير أيضاً تخصيص أي نص منه مباشرة من صفحة الدليل.',
    },
    {
      q: 'كيف أبحث داخل صفحة الدليل؟',
      a: 'استخدم شريط البحث الموجود أسفل العنوان في أعلى الصفحة. سيتم تمييز الكلمات المطابقة بلون مختلف والقفز إلى أول نتيجة تلقائياً، مع إمكانية التنقل بين النتائج.',
    },
  ],

  changelog: BUILT_IN_CHANGELOG,

  cta_title: 'هل تحتاج مساعدة إضافية؟',
  cta_description:
    'إذا واجهتك مشكلة أو لديك استفسار، تواصل مع إدارة النظام عبر نظام المراسلات الداخلي.',
};

type GuideView = typeof DEFAULTS;

function mergeContent(saved: UserGuideContent | undefined): GuideView {
  const out: GuideView = { ...DEFAULTS };
  if (!saved) return out;
  (Object.keys(saved) as (keyof UserGuideContent)[]).forEach((k) => {
    const v = saved[k];
    if (v === undefined || v === null) return;
    if (Array.isArray(v) && v.length === 0) return;
    if (typeof v === 'string' && v.trim() === '') return;
    // @ts-expect-error - dynamic key assignment across compatible shapes
    out[k] = v;
  });
  return out;
}

function deriveRole(user: { role?: string } | null | undefined): Role {
  const r = (user?.role || '').toLowerCase();
  if (r === 'owner') return 'owner';
  if (r === 'admin') return 'admin';
  if (r === 'engineer') return 'engineer';
  if (!user) return 'guest';
  return 'user';
}

/* ===========================================================================
   🔍 Search helpers
   =========================================================================== */

/** Escape user input for safe RegExp construction. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Highlight component — wraps every occurrence of the query in `<mark>` with
 * a data attribute so the page can enumerate matches for next/prev navigation.
 * Falls back to plain text when there's no query.
 */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;
  const trimmed = query.trim();
  if (!trimmed) return <>{text}</>;

  try {
    const re = new RegExp(`(${escapeRegExp(trimmed)})`, 'gi');
    const parts = text.split(re);
    return (
      <>
        {parts.map((part, i) => {
          if (i % 2 === 1) {
            return (
              <mark
                key={i}
                data-guide-match
                className="bg-yellow-300 text-black dark:bg-yellow-400 dark:text-black rounded px-0.5"
              >
                {part}
              </mark>
            );
          }
          return <span key={i}>{part}</span>;
        })}
      </>
    );
  } catch {
    return <>{text}</>;
  }
}

export default function UserGuide() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const role = deriveRole(user);
  const canEdit = role === 'admin' || role === 'owner';

  const [activeSection, setActiveSection] = useState<string>('intro');

  // ── Search state (read mode only) ──
  const [searchQuery, setSearchQuery] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
  const mainRef = useRef<HTMLElement | null>(null);

  const { data: savedContent } = useUserGuideContent();
  const updateGuide = useUpdateUserGuideContent();
  const markChangelogSeen = useMarkChangelogSeen();

  // Safety-net: ensure the red-dot indicator is cleared whenever the user
  // actually lands on the guide page — covers deep-links, back-navigation,
  // and refreshes where the header's click handler wasn't invoked.
  useEffect(() => {
    if (user) {
      markChangelogSeen.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<GuideView>(DEFAULTS);

  const content = useMemo(() => mergeContent(savedContent), [savedContent]);

  useEffect(() => {
    if (!editMode) setDraft(content);
  }, [content, editMode]);

  const visibleSections = useMemo(
    () => SECTIONS.filter((s) => isSectionVisible(s, role, editMode)),
    [role, editMode],
  );

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY + 120;
      for (const section of visibleSections) {
        const el = document.getElementById(section.id);
        if (el && el.offsetTop <= scrollY && el.offsetTop + el.offsetHeight > scrollY) {
          setActiveSection(section.id);
          break;
        }
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [visibleSections]);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const offset = 80;
      const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  };

  const handleLogin = () => navigate('/login');
  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const startEdit = () => {
    setDraft(content);
    setSearchQuery('');
    setEditMode(true);
  };
  const cancelEdit = () => {
    setDraft(content);
    setEditMode(false);
  };
  const resetAllToDefaults = () => {
    if (!confirm('هل تريد استعادة المحتوى الافتراضي لجميع الأقسام؟ سيتم استبدال كل التعديلات.')) return;
    setDraft(DEFAULTS);
  };

  const saveEdit = async () => {
    try {
      const payload: UserGuideContent = { ...draft };
      await updateGuide.mutateAsync(payload);
      toast.success('تم حفظ المحتوى بنجاح');
      setEditMode(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر حفظ المحتوى';
      toast.error(msg);
    }
  };

  /* ---------- draft helpers ---------- */

  const setField = useCallback(
    <K extends keyof GuideView>(key: K, value: GuideView[K]) => {
      setDraft((d) => ({ ...d, [key]: value }));
    },
    [],
  );

  const resetField = useCallback(<K extends keyof GuideView>(key: K) => {
    setDraft((d) => ({ ...d, [key]: DEFAULTS[key] }));
    toast.success('تمت استعادة المحتوى الافتراضي لهذا القسم');
  }, []);

  const setFaq = (idx: number, field: 'q' | 'a', value: string) => {
    setDraft((d) => {
      const arr = [...(d.faqs || [])];
      arr[idx] = { ...arr[idx], [field]: value };
      return { ...d, faqs: arr };
    });
  };
  const addFaq = () => {
    setDraft((d) => ({ ...d, faqs: [...(d.faqs || []), { q: '', a: '' }] }));
  };
  const removeFaq = (idx: number) => {
    setDraft((d) => {
      const arr = [...(d.faqs || [])];
      arr.splice(idx, 1);
      return { ...d, faqs: arr };
    });
  };

  const setChangelog = (idx: number, patch: Partial<GuideChangelogEntry>) => {
    setDraft((d) => {
      const arr = [...(d.changelog || [])];
      arr[idx] = { ...arr[idx], ...patch };
      return { ...d, changelog: arr };
    });
  };
  const addChangelogEntry = () => {
    const today = new Date().toISOString().slice(0, 10);
    setDraft((d) => ({
      ...d,
      changelog: [
        { date: today, type: 'feature', title: '', description: '' },
        ...(d.changelog || []),
      ],
    }));
  };
  const removeChangelogEntry = (idx: number) => {
    setDraft((d) => {
      const arr = [...(d.changelog || [])];
      arr.splice(idx, 1);
      return { ...d, changelog: arr };
    });
  };

  // Content to actually render.
  const view = editMode ? draft : content;
  const showSection = (id: string) => visibleSections.some((s) => s.id === id);

  // Normalize query for child components (ignored in edit mode).
  const effectiveQuery = editMode ? '' : searchQuery.trim();

  /* ---------- Search: recount matches + scroll on query change ---------- */

  // Rebuild list of matches whenever the query or view changes. Use a layout
  // effect so it runs after DOM updates from highlighting.
  useLayoutEffect(() => {
    if (!effectiveQuery) {
      setMatchCount(0);
      setCurrentMatchIdx(0);
      return;
    }
    // Defer to next frame so mark elements are in the DOM.
    const id = window.requestAnimationFrame(() => {
      const matches = document.querySelectorAll<HTMLElement>('[data-guide-match]');
      setMatchCount(matches.length);
      setCurrentMatchIdx(matches.length > 0 ? 0 : 0);
      if (matches.length > 0) {
        focusMatch(matches[0]);
      }
    });
    return () => window.cancelAnimationFrame(id);
    // view changes when admin saves; recomputed matches are desired.
  }, [effectiveQuery, view]);

  /** Scroll a mark into view and visually highlight it as the current one. */
  const focusMatch = (el: HTMLElement) => {
    // Reset previous "current" marker
    document.querySelectorAll<HTMLElement>('[data-guide-match-current="true"]').forEach((m) => {
      m.removeAttribute('data-guide-match-current');
      m.classList.remove('ring-2', 'ring-orange-500', 'bg-orange-300', 'dark:bg-orange-400');
      m.classList.add('bg-yellow-300', 'dark:bg-yellow-400');
    });
    el.setAttribute('data-guide-match-current', 'true');
    el.classList.remove('bg-yellow-300', 'dark:bg-yellow-400');
    el.classList.add('ring-2', 'ring-orange-500', 'bg-orange-300', 'dark:bg-orange-400');

    const rect = el.getBoundingClientRect();
    const scrollTop = window.scrollY + rect.top - 120;
    window.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
  };

  const gotoMatch = (direction: 'next' | 'prev') => {
    const matches = document.querySelectorAll<HTMLElement>('[data-guide-match]');
    if (matches.length === 0) return;
    let idx = currentMatchIdx;
    idx = direction === 'next' ? (idx + 1) % matches.length : (idx - 1 + matches.length) % matches.length;
    setCurrentMatchIdx(idx);
    focusMatch(matches[idx]);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setMatchCount(0);
    setCurrentMatchIdx(0);
  };

  return (
    <div className="min-h-screen bg-background user-guide-root" dir="rtl">
      <div className="no-print">
        <Header
          user={user ? { id: user.id, email: user.email ?? '', role: user.role, username: user.name } : null}
          onLogin={handleLogin}
          onLogout={handleLogout}
        />
      </div>

      {/* Hero */}
      <div className="relative overflow-hidden bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 dark:from-slate-900 dark:via-blue-950 dark:to-slate-900 text-white print-hero">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_20%_30%,_white_1px,_transparent_1px),radial-gradient(circle_at_80%_70%,_white_1px,_transparent_1px)] bg-[size:40px_40px] no-print" />
        <div className="container mx-auto px-4 py-10 sm:py-14 relative">
          <div className="flex items-start justify-between flex-wrap gap-3 mb-4 no-print">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/')}
              className="text-white hover:bg-white/10"
            >
              <Home className="h-4 w-4 ml-1" />
              العودة للرئيسية
            </Button>

            {!editMode && (
              <Button
                size="sm"
                onClick={() => {
                  // Use browser's native print (Save as PDF) — cleanest,
                  // preserves Arabic/RTL text rendering, and has zero extra
                  // dependencies. Print CSS below hides chrome and paginates.
                  window.print();
                }}
                className="bg-white text-blue-700 hover:bg-blue-50 shadow-md"
                title="تحميل الدليل كملف PDF (اختر «حفظ كـ PDF» من نافذة الطباعة)"
              >
                <Download className="h-4 w-4 ml-1" />
                تحميل الدليل PDF
              </Button>
            )}

            {canEdit && !editMode && (
              <Button
                size="sm"
                onClick={startEdit}
                className="bg-white text-blue-700 hover:bg-blue-50 shadow-md"
              >
                <Pencil className="h-4 w-4 ml-1" />
                تعديل الدليل
              </Button>
            )}
            {canEdit && editMode && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={resetAllToDefaults}
                  className="!bg-transparent !hover:bg-white/10 text-white border-white/40"
                >
                  <RotateCcw className="h-4 w-4 ml-1" />
                  استعادة كل الأقسام
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={cancelEdit}
                  disabled={updateGuide.isPending}
                  className="!bg-transparent !hover:bg-white/10 text-white border-white/40"
                >
                  <X className="h-4 w-4 ml-1" />
                  إلغاء
                </Button>
                <Button
                  size="sm"
                  onClick={saveEdit}
                  disabled={updateGuide.isPending}
                  className="bg-green-600 hover:bg-green-700 text-white shadow-md"
                >
                  {updateGuide.isPending ? (
                    <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 ml-1" />
                  )}
                  حفظ
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 mb-4">
            <div className="h-14 w-14 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center shadow-lg">
              <HelpCircle className="h-8 w-8 text-white" />
            </div>
            <div className="flex-1">
              {editMode ? (
                <>
                  <Input
                    value={view.hero_title}
                    onChange={(e) => setField('hero_title', e.target.value)}
                    className="!bg-white/10 border-white/30 text-white text-2xl sm:text-3xl font-bold h-auto py-2 placeholder:text-white/60"
                    placeholder="العنوان الرئيسي"
                  />
                  <Input
                    value={view.hero_subtitle}
                    onChange={(e) => setField('hero_subtitle', e.target.value)}
                    className="!bg-white/10 border-white/30 text-white mt-2 placeholder:text-white/60"
                    placeholder="العنوان الفرعي"
                  />
                </>
              ) : (
                <>
                  <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{view.hero_title}</h1>
                  <p className="text-blue-100 mt-1 text-sm sm:text-base">{view.hero_subtitle}</p>
                </>
              )}
            </div>
          </div>

          {/* Search bar — read mode only */}
          {!editMode && (
            <div className="mt-5 bg-white/95 dark:bg-slate-900/80 rounded-xl shadow-lg p-2 flex items-center gap-2 no-print">
              <div className="flex-1 flex items-center gap-2 px-2">
                <Search className="h-5 w-5 text-muted-foreground shrink-0" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث في عناوين الأقسام والفقرات والخطوات..."
                  className="w-full bg-transparent text-foreground placeholder:text-muted-foreground outline-none text-sm sm:text-base py-2"
                  aria-label="بحث داخل دليل الاستخدام"
                />
                {searchQuery && (
                  <span
                    className={`text-xs shrink-0 px-2 py-0.5 rounded-full ${
                      matchCount > 0
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200'
                    }`}
                  >
                    {matchCount > 0 ? `${currentMatchIdx + 1} / ${matchCount}` : 'لا نتائج'}
                  </span>
                )}
              </div>

              {searchQuery && matchCount > 0 && (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => gotoMatch('prev')}
                    className="h-8 w-8 text-foreground hover:bg-muted"
                    title="النتيجة السابقة"
                    aria-label="النتيجة السابقة"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => gotoMatch('next')}
                    className="h-8 w-8 text-foreground hover:bg-muted"
                    title="النتيجة التالية"
                    aria-label="النتيجة التالية"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {searchQuery && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={clearSearch}
                  className="h-8 w-8 text-muted-foreground hover:bg-muted shrink-0"
                  title="مسح البحث"
                  aria-label="مسح البحث"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}

          {editMode && (
            <div className="mt-3 p-3 rounded-lg bg-yellow-400/20 border border-yellow-300/40 text-yellow-50 text-sm flex items-center gap-2 no-print">
              <Pencil className="h-4 w-4" />
              أنت الآن في وضع التعديل. كل قسم يحتوي على زر "استعادة هذا القسم" لاسترجاع المحتوى الأصلي من الكود.
            </div>
          )}

          {!editMode && role === 'guest' && (
            <div className="mt-3 p-3 rounded-lg bg-white/10 border border-white/20 text-white/90 text-xs sm:text-sm flex items-center gap-2 no-print">
              <Info className="h-4 w-4 shrink-0" />
              يتم عرض الأقسام المتاحة للزوار. سجّل دخولك لرؤية أقسام إضافية حسب دورك.
            </div>
          )}
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar TOC */}
          <aside className="lg:w-72 shrink-0 no-print">
            <div className="lg:sticky lg:top-24">
              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-blue-600" />
                    المحتويات
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-2">
                  <nav className="flex flex-col gap-0.5 max-h-[70vh] overflow-y-auto">
                    {visibleSections.map((s) => {
                      const Icon = s.icon;
                      const isActive = activeSection === s.id;
                      return (
                        <button
                          key={s.id}
                          onClick={() => scrollToSection(s.id)}
                          className={`flex items-center gap-2 text-sm px-3 py-2 rounded-md text-right transition-colors ${
                            isActive
                              ? 'bg-blue-600 text-white'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="flex-1 truncate">
                            <Highlight text={s.title} query={effectiveQuery} />
                          </span>
                          {s.badge && (
                            <Badge
                              variant="secondary"
                              className={`text-[10px] ${
                                isActive
                                  ? 'bg-white/20 text-white border-0'
                                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                              }`}
                            >
                              {s.badge}
                            </Badge>
                          )}
                        </button>
                      );
                    })}
                  </nav>
                </CardContent>
              </Card>
            </div>
          </aside>

          {/* Content */}
          <main ref={mainRef} className="flex-1 min-w-0 space-y-6">
            {/* ─── Intro ─── */}
            {showSection('intro') && (
              <GuideSection
                id="intro"
                icon={Info}
                title="مقدمة"
                query={effectiveQuery}
                onReset={editMode ? () => resetField('intro_paragraphs') : undefined}
              >
                {editMode ? (
                  <EditableParagraphList
                    value={view.intro_paragraphs}
                    onChange={(v) => setField('intro_paragraphs', v)}
                  />
                ) : (
                  <>
                    {view.intro_paragraphs.map((p, i) => (
                      <p key={i}>
                        <Highlight text={p} query={effectiveQuery} />
                      </p>
                    ))}
                  </>
                )}
                <div className="grid sm:grid-cols-3 gap-3 pt-2">
                  <FeatureCard icon={FilePlus} color="blue" title="تقديم سريع" desc="أنشئ بلاغك خلال دقائق" query={effectiveQuery} />
                  <FeatureCard icon={Bell} color="amber" title="إشعارات فورية" desc="تابع حالة البلاغ مباشرة" query={effectiveQuery} />
                  <FeatureCard icon={CheckCircle2} color="green" title="متابعة منظمة" desc="لوحات إدارية واضحة" query={effectiveQuery} />
                </div>
              </GuideSection>
            )}

            {/* ─── Changelog ─── */}
            {showSection('changelog') && (
              <GuideSection
                id="changelog"
                icon={Sparkles}
                title="آخر التحديثات"
                query={effectiveQuery}
                onReset={editMode ? () => resetField('changelog') : undefined}
              >
                {editMode ? (
                  <div className="space-y-3">
                    {(view.changelog || []).map((entry, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-lg border border-border/60 bg-muted/30 space-y-2"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <Input
                            type="date"
                            value={entry.date}
                            onChange={(e) => setChangelog(i, { date: e.target.value })}
                            className="w-auto"
                          />
                          <select
                            value={entry.type || 'feature'}
                            onChange={(e) =>
                              setChangelog(i, {
                                type: e.target.value as GuideChangelogEntry['type'],
                              })
                            }
                            className="h-9 px-2 rounded-md border border-input bg-background text-sm"
                          >
                            <option value="feature">ميزة جديدة</option>
                            <option value="improvement">تحسين</option>
                            <option value="fix">إصلاح</option>
                            <option value="security">أمان</option>
                            <option value="other">أخرى</option>
                          </select>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => removeChangelogEntry(i)}
                            className="h-8 w-8 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 mr-auto"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <Input
                          value={entry.title}
                          onChange={(e) => setChangelog(i, { title: e.target.value })}
                          placeholder="عنوان التحديث"
                        />
                        <Textarea
                          value={entry.description}
                          onChange={(e) => setChangelog(i, { description: e.target.value })}
                          placeholder="وصف مختصر"
                          rows={2}
                        />
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addChangelogEntry}
                      className="w-full"
                    >
                      <Plus className="h-4 w-4 ml-1" />
                      إضافة تحديث جديد
                    </Button>
                  </div>
                ) : (
                  <ChangelogTimeline entries={view.changelog || []} query={effectiveQuery} />
                )}
              </GuideSection>
            )}

            {/* ─── Roles ─── */}
            {showSection('roles') && (
              <GuideSection
                id="roles"
                icon={ShieldCheck}
                title="أنواع المستخدمين"
                query={effectiveQuery}
                onReset={editMode ? () => resetField('roles_intro') : undefined}
              >
                {editMode ? (
                  <EditableTextarea
                    value={view.roles_intro}
                    onChange={(v) => setField('roles_intro', v)}
                    placeholder="النص التعريفي"
                  />
                ) : (
                  <p><Highlight text={view.roles_intro} query={effectiveQuery} /></p>
                )}
                <div className="grid sm:grid-cols-2 gap-3">
                  <RoleCard query={effectiveQuery} color="gray" role="زائر" desc="يمكن تصفح الموقع وتقديم بلاغ دون تسجيل" abilities={['تقديم بلاغ جديد', 'عرض الصفحة الرئيسية']} />
                  <RoleCard query={effectiveQuery} color="blue" role="مستخدم مسجّل" desc="صاحب حساب يتابع بلاغاته بشكل شخصي" abilities={['إنشاء بلاغات', 'متابعة بلاغاته', 'إضافة ملاحظات ومرفقات', 'المراسلات']} />
                  <RoleCard query={effectiveQuery} color="cyan" role="مهندس" desc="المسؤول عن تنفيذ الإصلاح" abilities={['استلام البلاغات المعينة له', 'تحديث حالة البلاغ', 'إضافة ملاحظات فنية']} />
                  <RoleCard query={effectiveQuery} color="red" role="مدير" desc="يدير المستخدمين والبلاغات والإعدادات" abilities={['إدارة المستخدمين والأدوار', 'تعيين المهندسين', 'تقارير وإحصائيات']} />
                  <RoleCard query={effectiveQuery} color="purple" role="مالك النظام" desc="أعلى صلاحية — تحكم كامل" abilities={['إعدادات الموقع العامة', 'تعديل الهوية البصرية', 'إدارة الصلاحيات']} />
                </div>
              </GuideSection>
            )}

            {/* ─── Register ─── */}
            {showSection('register') && (
              <GuideSection
                id="register"
                icon={UserPlus}
                title="إنشاء حساب جديد"
                query={effectiveQuery}
                onReset={editMode ? () => resetField('register_steps') : undefined}
              >
                {editMode ? (
                  <EditableStepList value={view.register_steps} onChange={(v) => setField('register_steps', v)} />
                ) : (
                  <StepList steps={view.register_steps} query={effectiveQuery} />
                )}
                {editMode ? (
                  <EditableTip value={view.register_tip} onChange={(v) => setField('register_tip', v)} />
                ) : (
                  <TipBox><Highlight text={view.register_tip} query={effectiveQuery} /></TipBox>
                )}
              </GuideSection>
            )}

            {/* ─── Login ─── */}
            {showSection('login') && (
              <GuideSection
                id="login"
                icon={LogIn}
                title="تسجيل الدخول"
                query={effectiveQuery}
                onReset={editMode ? () => resetField('login_steps') : undefined}
              >
                {editMode ? (
                  <EditableStepList value={view.login_steps} onChange={(v) => setField('login_steps', v)} />
                ) : (
                  <StepList steps={view.login_steps} query={effectiveQuery} />
                )}
                {editMode ? (
                  <EditableTip value={view.login_tip} onChange={(v) => setField('login_tip', v)} />
                ) : (
                  <TipBox><Highlight text={view.login_tip} query={effectiveQuery} /></TipBox>
                )}
              </GuideSection>
            )}

            {/* ─── Create report ─── */}
            {showSection('create-report') && (
              <GuideSection
                id="create-report"
                icon={FilePlus}
                title="إنشاء بلاغ صيانة"
                query={effectiveQuery}
                onReset={editMode ? () => resetField('create_report_steps') : undefined}
              >
                {editMode ? (
                  <EditableStepList value={view.create_report_steps} onChange={(v) => setField('create_report_steps', v)} />
                ) : (
                  <StepList steps={view.create_report_steps} query={effectiveQuery} />
                )}
                <div className="grid sm:grid-cols-2 gap-3 pt-2">
                  <FeatureCard icon={Search} color="blue" title="بحث ذكي عن المواقع" desc="ابحث بالاسم أو الرقم بسرعة" query={effectiveQuery} />
                  <FeatureCard icon={Download} color="green" title="رفع مرفقات" desc="صور وملفات لدعم البلاغ" query={effectiveQuery} />
                </div>
              </GuideSection>
            )}

            {/* ─── Track reports ─── */}
            {showSection('track-reports') && (
              <GuideSection
                id="track-reports"
                icon={Search}
                title="متابعة البلاغات"
                query={effectiveQuery}
                onReset={editMode ? () => resetField('track_items') : undefined}
              >
                {editMode ? (
                  <>
                    <EditableTextarea value={view.track_intro} onChange={(v) => setField('track_intro', v)} placeholder="النص التعريفي" />
                    <EditableBulletList value={view.track_items} onChange={(v) => setField('track_items', v)} />
                  </>
                ) : (
                  <>
                    <p><Highlight text={view.track_intro} query={effectiveQuery} /></p>
                    <ul className="list-disc pr-5 space-y-1.5 text-muted-foreground">
                      {view.track_items.map((item, i) => (
                        <li key={i}><Highlight text={item} query={effectiveQuery} /></li>
                      ))}
                    </ul>
                  </>
                )}
              </GuideSection>
            )}

            {/* ─── Report detail ─── */}
            {showSection('report-detail') && (
              <GuideSection
                id="report-detail"
                icon={FileText}
                title="تفاصيل البلاغ"
                query={effectiveQuery}
                onReset={editMode ? () => resetField('report_detail_intro') : undefined}
              >
                {editMode ? (
                  <EditableTextarea value={view.report_detail_intro} onChange={(v) => setField('report_detail_intro', v)} placeholder="النص التعريفي" />
                ) : (
                  <p><Highlight text={view.report_detail_intro} query={effectiveQuery} /></p>
                )}
                <div className="grid sm:grid-cols-2 gap-3">
                  <FeatureCard icon={Eye} color="blue" title="المعلومات الكاملة" desc="بيانات المُبلِّغ، الموقع، الحالة، الأولوية" query={effectiveQuery} />
                  <FeatureCard icon={MessageCircle} color="purple" title="الملاحظات والردود" desc="حوار مفتوح بين المعنيين" query={effectiveQuery} />
                  <FeatureCard icon={Wrench} color="cyan" title="تعيين المهندس" desc="تحديد المسؤول عن الإصلاح" query={effectiveQuery} />
                  <FeatureCard icon={Printer} color="green" title="الطباعة والتصدير" desc="نسخة مطبوعة احترافية" query={effectiveQuery} />
                </div>
                {editMode ? (
                  <EditableTip value={view.report_detail_tip} onChange={(v) => setField('report_detail_tip', v)} />
                ) : (
                  <TipBox><Highlight text={view.report_detail_tip} query={effectiveQuery} /></TipBox>
                )}
              </GuideSection>
            )}

            {/* ─── Notifications ─── */}
            {showSection('notifications') && (
              <GuideSection
                id="notifications"
                icon={Bell}
                title="الإشعارات"
                query={effectiveQuery}
                onReset={editMode ? () => resetField('notifications_items') : undefined}
              >
                {editMode ? (
                  <>
                    <EditableTextarea value={view.notifications_intro} onChange={(v) => setField('notifications_intro', v)} />
                    <EditableBulletList value={view.notifications_items} onChange={(v) => setField('notifications_items', v)} />
                  </>
                ) : (
                  <>
                    <p><Highlight text={view.notifications_intro} query={effectiveQuery} /></p>
                    <ul className="list-disc pr-5 space-y-1.5 text-muted-foreground">
                      {view.notifications_items.map((item, i) => (
                        <li key={i}><Highlight text={item} query={effectiveQuery} /></li>
                      ))}
                    </ul>
                  </>
                )}
              </GuideSection>
            )}

            {/* ─── Messages ─── */}
            {showSection('messages') && (
              <GuideSection
                id="messages"
                icon={MessageCircle}
                title="المراسلات"
                query={effectiveQuery}
                onReset={editMode ? () => resetField('messages_items') : undefined}
              >
                {editMode ? (
                  <>
                    <EditableTextarea value={view.messages_intro} onChange={(v) => setField('messages_intro', v)} />
                    <EditableBulletList value={view.messages_items} onChange={(v) => setField('messages_items', v)} />
                  </>
                ) : (
                  <>
                    <p><Highlight text={view.messages_intro} query={effectiveQuery} /></p>
                    <ul className="list-disc pr-5 space-y-1.5 text-muted-foreground">
                      {view.messages_items.map((item, i) => (
                        <li key={i}><Highlight text={item} query={effectiveQuery} /></li>
                      ))}
                    </ul>
                  </>
                )}
              </GuideSection>
            )}

            {/* ─── Online users ─── */}
            {showSection('online-users') && (
              <GuideSection
                id="online-users"
                icon={Users}
                title="المستخدمون المتصلون"
                query={effectiveQuery}
                onReset={editMode ? () => resetField('online_users_items') : undefined}
              >
                {editMode ? (
                  <>
                    <EditableTextarea value={view.online_users_intro} onChange={(v) => setField('online_users_intro', v)} />
                    <EditableBulletList value={view.online_users_items} onChange={(v) => setField('online_users_items', v)} />
                  </>
                ) : (
                  <>
                    <p><Highlight text={view.online_users_intro} query={effectiveQuery} /></p>
                    <ul className="list-disc pr-5 space-y-1.5 text-muted-foreground">
                      {view.online_users_items.map((item, i) => (
                        <li key={i}><Highlight text={item} query={effectiveQuery} /></li>
                      ))}
                    </ul>
                  </>
                )}
              </GuideSection>
            )}

            {/* ─── Engineer ─── */}
            {showSection('engineer') && (
              <GuideSection
                id="engineer"
                icon={Wrench}
                title="للمهندسين"
                badge="مهندس"
                query={effectiveQuery}
                onReset={editMode ? () => resetField('engineer_steps') : undefined}
              >
                {editMode ? (
                  <EditableTextarea value={view.engineer_intro} onChange={(v) => setField('engineer_intro', v)} />
                ) : (
                  <p><Highlight text={view.engineer_intro} query={effectiveQuery} /></p>
                )}
                {editMode ? (
                  <EditableStepList value={view.engineer_steps} onChange={(v) => setField('engineer_steps', v)} />
                ) : (
                  <StepList steps={view.engineer_steps} query={effectiveQuery} />
                )}
                {editMode ? (
                  <EditableTip value={view.engineer_tip} onChange={(v) => setField('engineer_tip', v)} />
                ) : (
                  <TipBox><Highlight text={view.engineer_tip} query={effectiveQuery} /></TipBox>
                )}
              </GuideSection>
            )}

            {/* ─── Contracts & Work Orders ─── */}
            {showSection('contracts') && (
              <GuideSection
                id="contracts"
                icon={ClipboardList}
                title="العقود وأوامر العمل"
                query={effectiveQuery}
                onReset={editMode ? () => resetField('contracts_steps') : undefined}
              >
                {editMode ? (
                  <EditableTextarea value={view.contracts_intro} onChange={(v) => setField('contracts_intro', v)} />
                ) : (
                  <p><Highlight text={view.contracts_intro} query={effectiveQuery} /></p>
                )}
                {editMode ? (
                  <EditableStepList value={view.contracts_steps} onChange={(v) => setField('contracts_steps', v)} />
                ) : (
                  <StepList steps={view.contracts_steps} query={effectiveQuery} />
                )}
                <div className="grid sm:grid-cols-2 gap-3 pt-2">
                  <FeatureCard icon={ClipboardList} color="blue" title="قائمة العقود" desc="عرض وفلترة جميع العقود مع الشركات المنفذة" query={effectiveQuery} />
                  <FeatureCard icon={Wrench} color="cyan" title="أوامر العمل" desc="إضافة ومتابعة أوامر العمل والمهندسين المسؤولين" query={effectiveQuery} />
                  <FeatureCard icon={FileText} color="purple" title="المصاميم والخطط" desc="تتبّع المخططات الهندسية لكل عقد" query={effectiveQuery} />
                  <FeatureCard icon={Calendar} color="amber" title="السنوات المالية" desc="توزيع ميزانية العقد على السنوات" query={effectiveQuery} />
                </div>
                {editMode ? (
                  <>
                    <EditableBulletList value={view.contracts_items} onChange={(v) => setField('contracts_items', v)} />
                    <EditableTip value={view.contracts_tip} onChange={(v) => setField('contracts_tip', v)} />
                  </>
                ) : (
                  <>
                    <ul className="list-disc pr-5 space-y-1.5 text-muted-foreground">
                      {view.contracts_items.map((item, i) => (
                        <li key={i}><Highlight text={item} query={effectiveQuery} /></li>
                      ))}
                    </ul>
                    <TipBox><Highlight text={view.contracts_tip} query={effectiveQuery} /></TipBox>
                  </>
                )}
              </GuideSection>
            )}

            {/* ─── Admin ─── */}
            {showSection('admin') && (
              <GuideSection
                id="admin"
                icon={UserCog}
                title="لوحة الإدارة"
                badge="مدير"
                query={effectiveQuery}
                onReset={editMode ? () => resetField('admin_intro') : undefined}
              >
                {editMode ? (
                  <EditableTextarea value={view.admin_intro} onChange={(v) => setField('admin_intro', v)} />
                ) : (
                  <p><Highlight text={view.admin_intro} query={effectiveQuery} /></p>
                )}
                <div className="grid sm:grid-cols-2 gap-3">
                  <FeatureCard icon={Users} color="blue" title="إدارة المستخدمين" desc="إضافة، تعديل، تعطيل الحسابات" query={effectiveQuery} />
                  <FeatureCard icon={ShieldCheck} color="purple" title="الأدوار والصلاحيات" desc="تخصيص صلاحيات كل دور" query={effectiveQuery} />
                  <FeatureCard icon={FileText} color="cyan" title="إنشاء بلاغات متعددة" desc="رفع ملف لإنشاء عدة بلاغات" query={effectiveQuery} />
                  <FeatureCard icon={Settings} color="amber" title="إعدادات الموقع" desc="اسم الموقع، الشعار، الوصف" query={effectiveQuery} />
                  <FeatureCard icon={ClipboardList} color="green" title="طلبات الحسابات" desc="مراجعة التسجيلات الجديدة" query={effectiveQuery} />
                  <FeatureCard icon={Bell} color="red" title="الإعلانات" desc="رسائل تظهر لجميع المستخدمين" query={effectiveQuery} />
                </div>
                {editMode ? (
                  <EditableTip value={view.admin_tip} onChange={(v) => setField('admin_tip', v)} />
                ) : (
                  <TipBox><Highlight text={view.admin_tip} query={effectiveQuery} /></TipBox>
                )}
              </GuideSection>
            )}

            {/* ─── Export ─── */}
            {showSection('export-print') && (
              <GuideSection
                id="export-print"
                icon={Printer}
                title="الطباعة والتصدير"
                query={effectiveQuery}
                onReset={editMode ? () => resetField('export_items') : undefined}
              >
                {editMode ? (
                  <>
                    <EditableTextarea value={view.export_intro} onChange={(v) => setField('export_intro', v)} />
                    <EditableBulletList value={view.export_items} onChange={(v) => setField('export_items', v)} />
                  </>
                ) : (
                  <>
                    <p><Highlight text={view.export_intro} query={effectiveQuery} /></p>
                    <ul className="list-disc pr-5 space-y-1.5 text-muted-foreground">
                      {view.export_items.map((item, i) => (
                        <li key={i}><Highlight text={item} query={effectiveQuery} /></li>
                      ))}
                    </ul>
                  </>
                )}
              </GuideSection>
            )}

            {/* ─── Security ─── */}
            {showSection('security') && (
              <GuideSection
                id="security"
                icon={KeyRound}
                title="الأمان والخصوصية"
                query={effectiveQuery}
                onReset={editMode ? () => resetField('security_items') : undefined}
              >
                {editMode ? (
                  <EditableBulletList value={view.security_items} onChange={(v) => setField('security_items', v)} />
                ) : (
                  <ul className="list-disc pr-5 space-y-1.5 text-muted-foreground">
                    {view.security_items.map((item, i) => (
                      <li key={i}><Highlight text={item} query={effectiveQuery} /></li>
                    ))}
                  </ul>
                )}
              </GuideSection>
            )}

            {/* ─── FAQs ─── */}
            {showSection('faq') && (
              <GuideSection
                id="faq"
                icon={HelpCircle}
                title="أسئلة شائعة"
                query={effectiveQuery}
                onReset={editMode ? () => resetField('faqs') : undefined}
              >
                {editMode ? (
                  <div className="space-y-3">
                    {(view.faqs || []).map((f, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-lg border border-border/60 bg-muted/30 space-y-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground shrink-0">سؤال {i + 1}</span>
                          <Input
                            value={f.q}
                            onChange={(e) => setFaq(i, 'q', e.target.value)}
                            placeholder="السؤال"
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => removeFaq(i)}
                            className="h-8 w-8 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <Textarea
                          value={f.a}
                          onChange={(e) => setFaq(i, 'a', e.target.value)}
                          placeholder="الإجابة"
                          rows={2}
                        />
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" onClick={addFaq} className="w-full">
                      <Plus className="h-4 w-4 ml-1" />
                      إضافة سؤال
                    </Button>
                  </div>
                ) : (
                  (view.faqs || []).map((f, i) => <FAQ key={i} q={f.q} a={f.a} query={effectiveQuery} />)
                )}
              </GuideSection>
            )}

            <Separator className="my-8" />

            <Card className="border-blue-200 dark:border-blue-900/50 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/40 dark:to-indigo-950/40">
              <CardContent className="p-6 text-center">
                <HelpCircle className="h-10 w-10 text-blue-600 dark:text-blue-400 mx-auto mb-3" />
                {editMode ? (
                  <>
                    <Input
                      value={view.cta_title}
                      onChange={(e) => setField('cta_title', e.target.value)}
                      className="text-center font-bold text-lg mb-2"
                      placeholder="عنوان البطاقة"
                    />
                    <Textarea
                      value={view.cta_description}
                      onChange={(e) => setField('cta_description', e.target.value)}
                      className="text-center text-sm mb-4"
                      rows={2}
                      placeholder="وصف البطاقة"
                    />
                  </>
                ) : (
                  <>
                    <h3 className="font-bold text-lg mb-2">
                      <Highlight text={view.cta_title} query={effectiveQuery} />
                    </h3>
                    <p className="text-muted-foreground text-sm mb-4">
                      <Highlight text={view.cta_description} query={effectiveQuery} />
                    </p>
                  </>
                )}
                <div className="flex flex-wrap gap-2 justify-center">
                  <Button onClick={() => navigate('/')} variant="outline">
                    <Home className="h-4 w-4 ml-1" />
                    الصفحة الرئيسية
                  </Button>
                  {user ? (
                    <Button onClick={() => navigate('/create')} className="bg-blue-600 hover:bg-blue-700 text-white">
                      <FilePlus className="h-4 w-4 ml-1" />
                      إنشاء بلاغ الآن
                    </Button>
                  ) : (
                    <Button onClick={handleLogin} className="bg-blue-600 hover:bg-blue-700 text-white">
                      <LogIn className="h-4 w-4 ml-1" />
                      تسجيل الدخول
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </main>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   Render helpers
   ========================================================================== */

const CHANGELOG_TYPE_META: Record<
  NonNullable<GuideChangelogEntry['type']>,
  { label: string; icon: React.ElementType; classes: string }
> = {
  feature: {
    label: 'جديد',
    icon: Sparkles,
    classes: 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
  },
  improvement: {
    label: 'تحسين',
    icon: Wand2,
    classes: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  },
  fix: {
    label: 'إصلاح',
    icon: Bug,
    classes: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  },
  security: {
    label: 'أمان',
    icon: ShieldCheck,
    classes: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300',
  },
  other: {
    label: 'تحديث',
    icon: Info,
    classes: 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
  },
};

function ChangelogTimeline({
  entries,
  query,
}: {
  entries: GuideChangelogEntry[];
  query: string;
}) {
  if (!entries.length) {
    return (
      <p className="text-sm text-muted-foreground">
        لا توجد تحديثات مسجّلة حالياً. ستظهر التحديثات الجديدة هنا تلقائياً.
      </p>
    );
  }
  return (
    <div className="relative pr-4">
      <div className="absolute right-1 top-1 bottom-1 w-0.5 bg-border" />
      <ol className="space-y-4">
        {entries.map((entry, i) => {
          const meta = CHANGELOG_TYPE_META[entry.type || 'feature'];
          const Icon = meta.icon;
          return (
            <li key={i} className="relative pr-6">
              <span className="absolute right-[-3px] top-1.5 h-3 w-3 rounded-full bg-blue-600 ring-4 ring-background" />
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <Badge className={`${meta.classes} border-0 flex items-center gap-1`}>
                  <Icon className="h-3 w-3" />
                  {meta.label}
                </Badge>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {formatArabicDate(entry.date)}
                </span>
              </div>
              <div className="font-semibold">
                <Highlight text={entry.title} query={query} />
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                <Highlight text={entry.description} query={query} />
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function formatArabicDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('ar-EG-u-ca-gregory-nu-latn', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

/* ==========================================================================
   Shared presentational components
   ========================================================================== */

function GuideSection({
  id,
  icon: Icon,
  title,
  badge,
  onReset,
  query = '',
  children,
}: {
  id: string;
  icon: React.ElementType;
  title: string;
  badge?: string;
  onReset?: () => void;
  query?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-3 border-b border-border/50">
          <CardTitle className="flex items-center gap-3 text-xl">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-md">
              <Icon className="h-5 w-5 text-white" />
            </div>
            <span className="flex-1">
              <Highlight text={title} query={query} />
            </span>
            {badge && (
              <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                {badge}
              </Badge>
            )}
            {onReset && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onReset}
                className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground"
                title="استعادة المحتوى الافتراضي لهذا القسم"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                استعادة هذا القسم
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-5 space-y-4 text-sm sm:text-base leading-relaxed">
          {children}
        </CardContent>
      </Card>
    </section>
  );
}

function StepList({ steps, query = '' }: { steps: string[]; query?: string }) {
  return (
    <ol className="space-y-2.5">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-3 items-start">
          <div className="h-7 w-7 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center shrink-0 shadow">
            {i + 1}
          </div>
          <p className="text-muted-foreground pt-0.5">
            <Highlight text={step} query={query} />
          </p>
        </li>
      ))}
    </ol>
  );
}

function TipBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50">
      <Info className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
      <p className="text-sm text-amber-900 dark:text-amber-200 leading-relaxed">{children}</p>
    </div>
  );
}

const COLOR_MAP: Record<string, string> = {
  blue: 'from-blue-500 to-blue-600 text-blue-600 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900/50',
  green: 'from-green-500 to-green-600 text-green-600 bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-900/50',
  purple: 'from-purple-500 to-purple-600 text-purple-600 bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-900/50',
  red: 'from-red-500 to-red-600 text-red-600 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/50',
  amber: 'from-amber-500 to-amber-600 text-amber-600 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/50',
  cyan: 'from-cyan-500 to-cyan-600 text-cyan-600 bg-cyan-50 dark:bg-cyan-950/40 border-cyan-200 dark:border-cyan-900/50',
  gray: 'from-gray-500 to-gray-600 text-gray-600 bg-gray-50 dark:bg-gray-950/40 border-gray-200 dark:border-gray-900/50',
};

function FeatureCard({
  icon: Icon,
  title,
  desc,
  color = 'blue',
  query = '',
}: {
  icon: React.ElementType;
  title: string;
  desc: string;
  color?: string;
  query?: string;
}) {
  const classes = COLOR_MAP[color] || COLOR_MAP.blue;
  return (
    <div className={`p-4 rounded-lg border ${classes.split(' ').slice(2).join(' ')}`}>
      <div
        className={`h-9 w-9 rounded-lg bg-gradient-to-br ${classes.split(' ').slice(0, 2).join(' ')} flex items-center justify-center mb-2 shadow`}
      >
        <Icon className="h-4 w-4 text-white" />
      </div>
      <div className="font-semibold text-sm mb-0.5">
        <Highlight text={title} query={query} />
      </div>
      <div className="text-xs text-muted-foreground">
        <Highlight text={desc} query={query} />
      </div>
    </div>
  );
}

function RoleCard({
  role,
  desc,
  abilities,
  color,
  query = '',
}: {
  role: string;
  desc: string;
  abilities: string[];
  color: string;
  query?: string;
}) {
  const classes = COLOR_MAP[color] || COLOR_MAP.gray;
  return (
    <div className={`p-4 rounded-lg border ${classes.split(' ').slice(2).join(' ')}`}>
      <div className="flex items-center gap-2 mb-2">
        <div
          className={`h-8 w-8 rounded-lg bg-gradient-to-br ${classes.split(' ').slice(0, 2).join(' ')} flex items-center justify-center shadow`}
        >
          <ShieldCheck className="h-4 w-4 text-white" />
        </div>
        <div className="font-bold">
          <Highlight text={role} query={query} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        <Highlight text={desc} query={query} />
      </p>
      <ul className="space-y-1">
        {abilities.map((a, i) => (
          <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ArrowRight className="h-3 w-3 mt-0.5 shrink-0 text-green-600" />
            <span><Highlight text={a} query={query} /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FAQ({ q, a, query = '' }: { q: string; a: string; query?: string }) {
  return (
    <div className="p-4 rounded-lg bg-muted/40 border border-border/60">
      <div className="flex gap-2 items-start mb-2">
        <HelpCircle className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
        <p className="font-semibold text-sm">
          <Highlight text={q} query={query} />
        </p>
      </div>
      <p className="text-sm text-muted-foreground pr-6 leading-relaxed">
        <Highlight text={a} query={query} />
      </p>
    </div>
  );
}

/* ==========================================================================
   Edit-mode input components
   ========================================================================== */

function EditableTextarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
      className="w-full"
    />
  );
}

function EditableTip({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50">
      <Info className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-2" />
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="نص التنبيه"
        rows={2}
        className="flex-1 !bg-white/60 dark:!bg-background/40"
      />
    </div>
  );
}

function EditableParagraphList({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const set = (idx: number, v: string) => {
    const copy = [...value];
    copy[idx] = v;
    onChange(copy);
  };
  const add = () => onChange([...value, '']);
  const remove = (idx: number) => {
    const copy = [...value];
    copy.splice(idx, 1);
    onChange(copy);
  };
  return (
    <div className="space-y-2">
      {value.map((p, i) => (
        <div key={i} className="flex gap-2">
          <Textarea
            value={p}
            onChange={(e) => set(i, e.target.value)}
            rows={2}
            placeholder={`الفقرة ${i + 1}`}
            className="flex-1"
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => remove(i)}
            className="h-8 w-8 shrink-0 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} className="w-full">
        <Plus className="h-4 w-4 ml-1" />
        إضافة فقرة
      </Button>
    </div>
  );
}

function EditableStepList({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const set = (idx: number, v: string) => {
    const copy = [...value];
    copy[idx] = v;
    onChange(copy);
  };
  const add = () => onChange([...value, '']);
  const remove = (idx: number) => {
    const copy = [...value];
    copy.splice(idx, 1);
    onChange(copy);
  };
  return (
    <div className="space-y-2">
      {value.map((s, i) => (
        <div key={i} className="flex gap-2 items-start">
          <div className="h-7 w-7 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center shrink-0 shadow mt-1">
            {i + 1}
          </div>
          <Textarea
            value={s}
            onChange={(e) => set(i, e.target.value)}
            rows={2}
            placeholder={`الخطوة ${i + 1}`}
            className="flex-1"
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => remove(i)}
            className="h-8 w-8 shrink-0 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 mt-1"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} className="w-full">
        <Plus className="h-4 w-4 ml-1" />
        إضافة خطوة
      </Button>
    </div>
  );
}

function EditableBulletList({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const set = (idx: number, v: string) => {
    const copy = [...value];
    copy[idx] = v;
    onChange(copy);
  };
  const add = () => onChange([...value, '']);
  const remove = (idx: number) => {
    const copy = [...value];
    copy.splice(idx, 1);
    onChange(copy);
  };
  return (
    <div className="space-y-2">
      {value.map((s, i) => (
        <div key={i} className="flex gap-2 items-start">
          <span className="mt-3 h-1.5 w-1.5 rounded-full bg-muted-foreground shrink-0" />
          <Textarea
            value={s}
            onChange={(e) => set(i, e.target.value)}
            rows={2}
            placeholder={`عنصر ${i + 1}`}
            className="flex-1"
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => remove(i)}
            className="h-8 w-8 shrink-0 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 mt-1"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} className="w-full">
        <Plus className="h-4 w-4 ml-1" />
        إضافة عنصر
      </Button>
    </div>
  );
}