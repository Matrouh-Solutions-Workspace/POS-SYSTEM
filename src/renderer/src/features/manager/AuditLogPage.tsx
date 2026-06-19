/**
 * Audit Log - REQ-7
 * Read-only view of all system actions. Manager access only.
 */
import { useEffect, useMemo, useState } from 'react'
import { listAuditEntries, type AuditDateRange } from '@renderer/features/audit/audit-service'
import type { AuditEntry, AuditAction } from '@shared/types'
import { listAllAccounts } from '@renderer/features/auth/auth-service'

const RANGE_OPTIONS: { value: AuditDateRange; label: string }[] = [
  { value: 'today', label: 'اليوم' },
  { value: 'week',  label: 'آخر ٧ أيام' },
  { value: 'month', label: 'آخر ٣٠ يوم' },
  { value: 'all',   label: 'كل السجل' }
]

const ACTION_LABELS: Record<AuditAction, string> = {
  login:                     'تسجيل دخول',
  logout:                    'تسجيل خروج',
  order_cancelled:           'إلغاء طلب',
  discount_applied:          'خصم مطبق',
  manager_override_discount: 'تجاوز خصم بموافقة مدير',
  order_refunded:            'استرداد طلب',
  account_created:           'إنشاء حساب',
  account_updated:           'تعديل حساب',
  account_deactivated:       'تعديل حالة حساب',
  account_deleted:           'حذف حساب',
  settings_changed:          'تغيير إعدادات',
  shift_opened:              'فتح شيفت',
  shift_closed:              'إغلاق شيفت',
  cash_in:                   'إضافة نقدية',
  cash_out:                  'سحب نقدي',
  menu_category_created:     'إضافة تصنيف',
  menu_category_updated:     'تعديل تصنيف',
  menu_category_deleted:     'حذف تصنيف',
  menu_item_created:         'إضافة صنف',
  menu_item_updated:         'تعديل صنف',
  menu_item_deleted:         'حذف صنف',
  item_size_created:         'إضافة حجم',
  item_size_updated:         'تعديل حجم',
  item_size_deleted:         'حذف حجم',
  item_addon_created:        'إضافة إضافة',
  item_addon_updated:        'تعديل إضافة',
  item_addon_deleted:        'حذف إضافة',
  ingredient_created:        'إضافة مكوّن',
  ingredient_updated:        'تعديل مكوّن',
  ingredient_deleted:        'حذف مكوّن',
  inventory_purchase:        'شراء مخزون',
  inventory_waste:           'هدر مخزون',
  inventory_adjustment:      'تسوية مخزون',
  supplier_created:          'إضافة مورد',
  supplier_updated:          'تعديل مورد',
  supplier_deleted:          'حذف مورد',
  supplier_transaction_recorded: 'حركة مورد',
  kitchen_printer_created:   'إضافة طابعة تجهيز',
  kitchen_printer_updated:   'تعديل طابعة تجهيز',
  kitchen_printer_deleted:   'حذف طابعة تجهيز'
}

const TARGET_LABELS: Record<NonNullable<AuditEntry['targetType']>, string> = {
  order: 'طلب',
  user: 'مستخدم',
  shift: 'شيفت',
  settings: 'إعدادات',
  cash: 'نقدية',
  menu_category: 'تصنيف',
  menu_item: 'صنف',
  item_size: 'حجم',
  item_addon: 'إضافة',
  ingredient: 'مكوّن',
  inventory: 'مخزون',
  supplier: 'مورد',
  printer: 'طابعة'
}

const ACTION_BADGE: Record<AuditAction, string> = {
  login:                     'badge--info',
  logout:                    'badge--muted',
  order_cancelled:           'badge--danger',
  discount_applied:          'badge--warning',
  manager_override_discount: 'badge--warning',
  order_refunded:            'badge--danger',
  account_created:           'badge--success',
  account_updated:           'badge--info',
  account_deactivated:       'badge--warning',
  account_deleted:           'badge--danger',
  settings_changed:          'badge--info',
  shift_opened:              'badge--success',
  shift_closed:              'badge--muted',
  cash_in:                   'badge--success',
  cash_out:                  'badge--warning',
  menu_category_created:     'badge--success',
  menu_category_updated:     'badge--info',
  menu_category_deleted:     'badge--danger',
  menu_item_created:         'badge--success',
  menu_item_updated:         'badge--info',
  menu_item_deleted:         'badge--danger',
  item_size_created:         'badge--success',
  item_size_updated:         'badge--info',
  item_size_deleted:         'badge--danger',
  item_addon_created:        'badge--success',
  item_addon_updated:        'badge--info',
  item_addon_deleted:        'badge--danger',
  ingredient_created:        'badge--success',
  ingredient_updated:        'badge--info',
  ingredient_deleted:        'badge--danger',
  inventory_purchase:        'badge--success',
  inventory_waste:           'badge--warning',
  inventory_adjustment:      'badge--info',
  supplier_created:          'badge--success',
  supplier_updated:          'badge--info',
  supplier_deleted:          'badge--danger',
  supplier_transaction_recorded: 'badge--info',
  kitchen_printer_created:   'badge--success',
  kitchen_printer_updated:   'badge--info',
  kitchen_printer_deleted:   'badge--danger'
}

export function AuditLogPage(): React.ReactElement {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [usernamesById, setUsernamesById] = useState<Record<string, string>>({})
  const [range, setRange] = useState<AuditDateRange>('today')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState<'all' | AuditAction>('all')
  const [actorFilter, setActorFilter] = useState('all')
  const [targetFilter, setTargetFilter] = useState<'all' | NonNullable<AuditEntry['targetType']>>('all')

  useEffect(() => {
    setLoading(true)
    void Promise.all([listAuditEntries(range), listAllAccounts()]).then(([data, users]) => {
      setEntries(data)
      setUsernamesById(Object.fromEntries(users.map((user) => [user.id, user.username])))
      setLoading(false)
    })
  }, [range])

  function actorLabel(entry: AuditEntry): string {
    const username = usernamesById[entry.actorId]
    if (username) return username
    if (entry.actorId === 'system') return entry.actorName
    const localUser = entry.actorId.match(/^local_(.+?)(?:_\d+)?$/)
    return localUser?.[1] ?? entry.actorName
  }

  const actors = useMemo(() => {
    return Array.from(new Set(entries.map((e) => actorLabel(e)).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ar'))
  }, [entries, usernamesById])

  const availableTargets = useMemo(() => {
    return Array.from(new Set(entries.map((e) => e.targetType).filter(Boolean))) as Array<NonNullable<AuditEntry['targetType']>>
  }, [entries])

  const filtered = entries.filter((entry) => {
    const q = search.trim()
    const matchesText = !q ||
      entry.actorName.includes(q) ||
      actorLabel(entry).includes(q) ||
      entry.detailAr.includes(q) ||
      entry.targetId?.includes(q) ||
      ACTION_LABELS[entry.action].includes(q)
    const matchesAction = actionFilter === 'all' || entry.action === actionFilter
    const displayActor = actorLabel(entry)
    const matchesActor = actorFilter === 'all' || displayActor === actorFilter
    const matchesTarget = targetFilter === 'all' || entry.targetType === targetFilter
    return matchesText && matchesAction && matchesActor && matchesTarget
  })

  function resetFilters(): void {
    setSearch('')
    setActionFilter('all')
    setActorFilter('all')
    setTargetFilter('all')
  }

  return (
    <div className="unified-page">
      <div className="page-toolbar" style={{ marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div className="reports-filter__options" aria-label="اختيار فترة سجل الأحداث">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={range === opt.value}
              className={`reports-filter__btn${range === opt.value ? ' reports-filter__btn--active' : ''}`}
              onClick={() => setRange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <input
          className="pos-search"
          style={{ maxWidth: 260, flex: 1 }}
          placeholder="بحث في سجل الأحداث..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="settings-form-grid" style={{ marginBottom: 16 }}>
        <label className="field">
          <span>نوع الحدث</span>
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value as typeof actionFilter)}>
            <option value="all">كل الأحداث</option>
            {(Object.keys(ACTION_LABELS) as AuditAction[]).map((action) => (
              <option key={action} value={action}>{ACTION_LABELS[action]}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>المستخدم</span>
          <select value={actorFilter} onChange={(e) => setActorFilter(e.target.value)}>
            <option value="all">كل المستخدمين</option>
            {actors.map((actor) => <option key={actor} value={actor}>{actor}</option>)}
          </select>
        </label>
        <label className="field">
          <span>العنصر المتأثر</span>
          <select value={targetFilter} onChange={(e) => setTargetFilter(e.target.value as typeof targetFilter)}>
            <option value="all">الكل</option>
            {availableTargets.map((target) => (
              <option key={target} value={target}>{TARGET_LABELS[target]}</option>
            ))}
          </select>
        </label>
        <div className="field" style={{ justifyContent: 'end' }}>
          <button type="button" className="btn btn--secondary" onClick={resetFilters}>
            إعادة ضبط الفلاتر
          </button>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 className="card__title" style={{ margin: 0 }}>سجل الأحداث</h2>
          <span style={{ fontSize: '0.82rem', color: 'var(--color-muted)' }}>
            {filtered.length} حدث
          </span>
        </div>

        {loading ? (
          <p className="app-loading">جارٍ التحميل…</p>
        ) : filtered.length === 0 ? (
          <p className="report-empty">لا توجد أحداث مطابقة للفلاتر الحالية</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>المستخدم</th>
                  <th>الحدث</th>
                  <th>العنصر</th>
                  <th>التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr key={entry.id}>
                    <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', color: 'var(--color-muted)' }}>
                      {new Date(entry.createdAt).toLocaleString('ar-EG')}
                    </td>
                    <td style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                      {actorLabel(entry)}
                    </td>
                    <td>
                      <span
                        className={`role-badge ${ACTION_BADGE[entry.action] ?? 'badge--info'}`}
                        style={{ fontSize: '0.78rem', padding: '2px 8px', borderRadius: 12, display: 'inline-block' }}
                      >
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--color-muted)' }}>
                      {entry.targetType ? TARGET_LABELS[entry.targetType] : '-'}
                      {entry.targetId ? <code dir="ltr" style={{ display: 'block', marginTop: 4 }}>{entry.targetId}</code> : null}
                    </td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--color-muted)', maxWidth: 320, wordBreak: 'break-word' }}>
                      {entry.detailAr}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
