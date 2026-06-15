/**
 * Changelog — update this file with every release.
 *
 * Rules:
 *  - Add a new entry at the TOP of the array for each version.
 *  - `version` must match the version string in package.json exactly.
 *  - `date` is display-only (Arabic or Gregorian, your choice).
 *  - Each item in `changes` is one bullet point shown in the modal.
 *  - `type` controls the bullet color: 'new' | 'fix' | 'improve'
 */

export interface ChangeEntry {
  type: 'new' | 'fix' | 'improve'
  text: string
}

export interface VersionLog {
  version: string
  date: string
  changes: ChangeEntry[]
}

export const CHANGELOG: VersionLog[] = [
  {
    version: '2.1.6',
    date: '13 يونيو 2026',
    changes: [
      // ── Items system ─────────────────────────────────────────────────────
      { type: 'new',     text: 'تصنيفات الأصناف الجديدة: منتج / مادة خام / خدمة — مع تفاصيل نوع المنتج (وصفة / جاهز / مصنوع / بدون مخزون)' },
      { type: 'new',     text: 'إدارة الأحجام: قائمة أحجام مسبقة التعريف (صغير / وسط / كبير…) يختار منها المستخدم عند إنشاء الأصناف' },
      { type: 'new',     text: 'إدارة الإضافات: قائمة مرفقات مسبقة التعريف (جبنة إضافية / صوص / بطاطس…) مع سعر افتراضي لكل إضافة' },
      { type: 'new',     text: 'صفحة الأصناف أصبحت 5 تابات: الأصناف / التصنيفات / الأحجام / الإضافات / المواد الخام' },
      { type: 'new',     text: 'إدارة المواد الخام مباشرةً من صفحة الأصناف بدون الحاجة للانتقال لصفحة المشتريات' },
      // ── Keyboard shortcuts ───────────────────────────────────────────────
      { type: 'new',     text: 'اختصارات لوحة المفاتيح: Ctrl+Tab / Ctrl+Shift+Tab للتنقل بين التابات المفتوحة' },
      { type: 'new',     text: 'اختصار Ctrl+W لإغلاق التاب الحالي' },
      { type: 'new',     text: 'اختصار Ctrl+Shift+→ / ← للتنقل بين أجزاء الشاشة المقسومة (Split View)' },
      { type: 'new',     text: 'تاب "الاختصارات" في الإعدادات — يمكن تخصيص كل اختصار بالضغط عليه وتسجيل مفاتيح جديدة' },
      // ── UI / UX ──────────────────────────────────────────────────────────
      { type: 'new',     text: 'الشريط الجانبي يتقلص تلقائيًا إلى أيقونات عند تفعيل الشاشة المقسومة مع زر لإعادة التوسيع' },
      { type: 'improve', text: 'تحديث صفحه الصاله **' },
      { type: 'improve', text: 'صفحة الإعدادات أصبحت 6 تابات: عام / الترابيزات / المظهر / PIN والقفل / نسخ احتياطي / الاختصارات' },
      { type: 'fix',     text: 'إصلاح: التاب يبقى قابلاً للضغط بعد السحب وعدم الحاجة للتنقل لتاب آخر لإعادة التفعيل' },
    ]
  },
  {
    version: '2.1.5',
    date: '1 يونيو 2026',
    changes: [
      { type: 'new',     text: 'إمكانية إضافة صنف بدون مكوّنات (بدون خصم مخزون عند الطلب)' },
      { type: 'new',     text: 'حفظ محتوى التابات تلقائيًا — البيانات المدخلة لا تُمسح عند التبديل بين التابات' },
    ]
  },
  {
    version: '2.1.4',
    date: '1 يونيو 2026',
    changes: [
      { type: 'fix',     text: 'إصلاح مشكلة في حساب الضريبة على طلبات التوصيل' },
      { type: 'improve', text: 'تحسين سرعة تحميل صفحة الكاشير' },
    ]
  },
]
