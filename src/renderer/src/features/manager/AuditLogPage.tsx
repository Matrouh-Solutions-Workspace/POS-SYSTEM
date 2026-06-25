/**
 * Audit Log - REQ-7
 * Read-only view of all system actions. Manager access only.
 */
import { useEffect, useMemo, useState } from 'react'
import { listAuditEntries, type AuditDateRange } from '@renderer/features/audit/audit-service'
import type { AppUser, AuditEntry, AuditAction, Ingredient, InventoryTransaction, ItemAddon, ItemSize, KitchenPrinter, MenuCategory, MenuItem, Order, Supplier, SupplierTransaction } from '@shared/types'
import { listAllAccounts } from '@renderer/features/auth/auth-service'
import { COLLECTIONS } from '@shared/constants/collections'
import { getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { orderReference } from '@shared/services/order-reference'

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
  work_shift_created:        'إنشاء وردية عمل',
  work_shift_updated:        'تعديل وردية عمل',
  work_shift_deleted:        'حذف وردية عمل',
  shift_assignment_created:  'تعيين وردية لموظف',
  shift_assignment_updated:  'تعديل تعيين وردية',
  shift_assignment_deleted:  'حذف تعيين وردية',
  overtime_recorded:         'تسجيل عمل إضافي',
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
  work_shift: 'وردية عمل',
  shift_assignment: 'تعيين وردية',
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
  work_shift_created:        'badge--success',
  work_shift_updated:        'badge--info',
  work_shift_deleted:        'badge--danger',
  shift_assignment_created:  'badge--success',
  shift_assignment_updated:  'badge--info',
  shift_assignment_deleted:  'badge--danger',
  overtime_recorded:         'badge--warning',
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
  const [targetNames, setTargetNames] = useState<Record<string, string>>({})
  const [detailsEntry, setDetailsEntry] = useState<AuditEntry | null>(null)
  const [range, setRange] = useState<AuditDateRange>('today')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState<'all' | AuditAction>('all')
  const [actorFilter, setActorFilter] = useState('all')
  const [targetFilter, setTargetFilter] = useState<'all' | NonNullable<AuditEntry['targetType']>>('all')

  useEffect(() => {
    setLoading(true)
    void Promise.all([listAuditEntries(range), listAllAccounts()]).then(async ([data, users]) => {
      setEntries(data)
      setUsernamesById(Object.fromEntries(users.map((user) => [user.id, user.username])))
      setTargetNames(await buildTargetNameMap(data, users))
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

  function targetKey(entry: AuditEntry): string | null {
    return entry.targetType && entry.targetId ? `${entry.targetType}:${entry.targetId}` : null
  }

  function targetLabel(entry: AuditEntry): string {
    const key = targetKey(entry)
    if (key && targetNames[key]) return targetNames[key]
    if (entry.targetType === 'settings') return 'إعدادات المطعم'
    return entry.targetId ?? '-'
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
      targetLabel(entry).includes(q) ||
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
                  <th>إجراء</th>
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
                      {entry.targetId ? <span style={{ display: 'block', marginTop: 4, color: 'var(--color-text)', fontWeight: 700 }}>{targetLabel(entry)}</span> : null}
                    </td>
                    <td>
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => setDetailsEntry(entry)}>
                        عرض التفاصيل
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {detailsEntry && (
        <div className="modal-overlay" onClick={() => setDetailsEntry(null)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="order-details__header">
              <h2 className="order-details__title">تفاصيل الحدث</h2>
              <button type="button" className="order-details__close" onClick={() => setDetailsEntry(null)} aria-label="إغلاق">✕</button>
            </div>
            <div className="order-details__meta">
              <div className="order-details__meta-row"><span className="order-details__meta-label">الوقت</span><span>{new Date(detailsEntry.createdAt).toLocaleString('ar-EG')}</span></div>
              <div className="order-details__meta-row"><span className="order-details__meta-label">المستخدم</span><span dir="ltr">{actorLabel(detailsEntry)}</span></div>
              <div className="order-details__meta-row"><span className="order-details__meta-label">الحدث</span><span>{ACTION_LABELS[detailsEntry.action] ?? detailsEntry.action}</span></div>
              <div className="order-details__meta-row"><span className="order-details__meta-label">العنصر</span><span>{detailsEntry.targetType ? `${TARGET_LABELS[detailsEntry.targetType]} — ${targetLabel(detailsEntry)}` : '-'}</span></div>
              {detailsEntry.targetId && (
                <div className="order-details__meta-row"><span className="order-details__meta-label">المعرّف</span><code dir="ltr">{detailsEntry.targetId}</code></div>
              )}
            </div>
            <p style={{ margin: '14px 0 0', lineHeight: 1.8, color: 'var(--color-text)' }}>{detailsEntry.detailAr}</p>
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button type="button" className="btn btn--primary btn--sm" onClick={() => setDetailsEntry(null)}>إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

async function buildTargetNameMap(entries: AuditEntry[], users: AppUser[]): Promise<Record<string, string>> {
  const needs = new Set(entries.map((entry) => entry.targetType).filter(Boolean))
  const [
    orders,
    categories,
    menuItems,
    sizes,
    addons,
    ingredients,
    inventoryTransactions,
    suppliers,
    supplierTransactions,
    printers
  ] = await Promise.all([
    needs.has('order') ? getCachedDocs<Order>(COLLECTIONS.orders) : Promise.resolve([]),
    needs.has('menu_category') ? getCachedDocs<MenuCategory>(COLLECTIONS.menuCategories) : Promise.resolve([]),
    needs.has('menu_item') ? getCachedDocs<MenuItem>(COLLECTIONS.menuItems) : Promise.resolve([]),
    needs.has('item_size') ? getCachedDocs<ItemSize>(COLLECTIONS.itemSizes) : Promise.resolve([]),
    needs.has('item_addon') ? getCachedDocs<ItemAddon>(COLLECTIONS.itemAddons) : Promise.resolve([]),
    needs.has('ingredient') || needs.has('inventory') ? getCachedDocs<Ingredient>(COLLECTIONS.ingredients) : Promise.resolve([]),
    needs.has('inventory') ? getCachedDocs<InventoryTransaction>(COLLECTIONS.inventoryTransactions) : Promise.resolve([]),
    needs.has('supplier') ? getCachedDocs<Supplier>(COLLECTIONS.suppliers) : Promise.resolve([]),
    needs.has('supplier') ? getCachedDocs<SupplierTransaction>(COLLECTIONS.supplierTransactions) : Promise.resolve([]),
    needs.has('printer') ? getCachedDocs<KitchenPrinter>(COLLECTIONS.kitchenPrinters) : Promise.resolve([])
  ])

  const usersById = new Map(users.map((user) => [user.id, user.username]))
  const ordersById = new Map(orders.map((order) => [order.id, `طلب #${orderReference(order)}`]))
  const categoriesById = new Map(categories.map((category) => [category.id, category.nameAr]))
  const menuItemsById = new Map(menuItems.map((item) => [item.id, item.nameAr]))
  const sizesById = new Map(sizes.map((size) => [size.id, size.nameAr]))
  const addonsById = new Map(addons.map((addon) => [addon.id, addon.nameAr]))
  const ingredientsById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient.nameAr]))
  const suppliersById = new Map(suppliers.map((supplier) => [supplier.id, supplier.nameAr]))
  const printersById = new Map(printers.map((printer) => [printer.id, printer.name]))
  const inventoryById = new Map(inventoryTransactions.map((tx) => [tx.id, ingredientsById.get(tx.ingredientId) ?? 'حركة مخزون']))
  const supplierTxById = new Map(supplierTransactions.map((tx) => [tx.id, suppliersById.get(tx.supplierId) ?? 'حركة مورد']))

  const map: Record<string, string> = {}
  for (const entry of entries) {
    if (!entry.targetType || !entry.targetId) continue
    const key = `${entry.targetType}:${entry.targetId}`
    const value =
      entry.targetType === 'order' ? ordersById.get(entry.targetId) :
      entry.targetType === 'user' ? usersById.get(entry.targetId) :
      entry.targetType === 'menu_category' ? categoriesById.get(entry.targetId) :
      entry.targetType === 'menu_item' ? menuItemsById.get(entry.targetId) :
      entry.targetType === 'item_size' ? sizesById.get(entry.targetId) :
      entry.targetType === 'item_addon' ? addonsById.get(entry.targetId) :
      entry.targetType === 'ingredient' ? ingredientsById.get(entry.targetId) :
      entry.targetType === 'inventory' ? inventoryById.get(entry.targetId) :
      entry.targetType === 'supplier' ? supplierTxById.get(entry.targetId) ?? suppliersById.get(entry.targetId) :
      entry.targetType === 'printer' ? printersById.get(entry.targetId) :
      entry.targetType === 'settings' ? 'إعدادات المطعم' :
      undefined
    if (value) map[key] = value
  }
  return map
}
