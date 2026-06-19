import { useEffect, useState } from 'react'
import type { Order, OrderItem } from '@shared/types'
import {
  listOrders,
  getOrderItems,
  getSettings,
  archiveOrders,
  unarchiveOrders
} from '@renderer/features/orders/order-service'
import { listUsersByRole } from '@renderer/features/auth/auth-service'
import { printReceipt } from '@renderer/features/receipt/receipt-builder'
import { MdArchive, MdUnarchive, MdVisibility, MdPrint, MdFilterList } from 'react-icons/md'
import { orderReference } from '@shared/services/order-reference'

type ViewMode = 'active' | 'archived'

interface OrderDetails {
  order: Order
  items: OrderItem[]
}

function dateKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

export function CashierHistoryPage(): React.ReactElement {
  const [orders, setOrders] = useState<Order[]>([])
  const [cashierNames, setCashierNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('active')
  const [selectedCashier, setSelectedCashier] = useState<string>('all')
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [details, setDetails] = useState<OrderDetails | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const cur = 'ج.م'

  async function load(): Promise<void> {
    setLoading(true)
    setSelected(new Set())
    const [all, cashiers] = await Promise.all([
      listOrders(1000),
      listUsersByRole('cashier')
    ])
    const completed = all.filter((o) => o.status === 'completed')
    setOrders(completed)
    const names = [...new Set(completed.map((o) => o.cashierName))].sort()
    setCashierNames(names)
    const userNames = cashiers.map((c) => c.displayName)
    setCashierNames([...new Set([...names, ...userNames])].sort())
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filtered = orders.filter((o) => {
    if (viewMode === 'active' && o.archived) return false
    if (viewMode === 'archived' && !o.archived) return false
    if (selectedCashier !== 'all' && o.cashierName !== selectedCashier) return false
    if (selectedDate) {
      const orderDate = dateKey(o.completedAt ?? o.createdAt)
      if (orderDate !== selectedDate) return false
    }
    return true
  })

  // ── Group by date then cashier ─────────────────────────────────────────────
  const grouped = filtered.reduce<Record<string, Record<string, Order[]>>>((acc, o) => {
    const date = dateKey(o.completedAt ?? o.createdAt)
    if (!acc[date]) acc[date] = {}
    if (!acc[date][o.cashierName]) acc[date][o.cashierName] = []
    acc[date][o.cashierName].push(o)
    return acc
  }, {})
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  // ── Selection ─────────────────────────────────────────────────────────────
  function toggleSelect(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll(): void {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((o) => o.id)))
    }
  }

  function selectDateCashier(dateOrders: Order[]): void {
    const ids = dateOrders.map((o) => o.id)
    const allSelected = ids.every((id) => selected.has(id))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        ids.forEach((id) => next.delete(id))
      } else {
        ids.forEach((id) => next.add(id))
      }
      return next
    })
  }

  // ── Archive actions ────────────────────────────────────────────────────────
  async function handleArchive(): Promise<void> {
    if (selected.size === 0) return
    await archiveOrders([...selected])
    setActionMsg(`تم أرشفة ${selected.size} طلب`)
    await load()
    setTimeout(() => setActionMsg(null), 3000)
  }

  async function handleUnarchive(): Promise<void> {
    if (selected.size === 0) return
    await unarchiveOrders([...selected])
    setActionMsg(`تم إلغاء أرشفة ${selected.size} طلب`)
    await load()
    setTimeout(() => setActionMsg(null), 3000)
  }

  // ── Details ───────────────────────────────────────────────────────────────
  async function openDetails(order: Order): Promise<void> {
    setDetailsLoading(true)
    const items = await getOrderItems(order.id)
    setDetails({ order, items })
    setDetailsLoading(false)
  }

  async function reprintOrder(order: Order): Promise<void> {
    const [items, settings] = await Promise.all([getOrderItems(order.id), getSettings()])
    await printReceipt(order, items, settings)
  }

  // ── Totals for filtered ────────────────────────────────────────────────────
  const totalRevenue = filtered.reduce((s, o) => s + o.total, 0)

  return (
    <div className="cashier-history">

      {/* ── Toolbar ── */}
      <div className="cashier-history__toolbar">
        {/* View mode toggle */}
        <div className="reports-filter__options">
          <button type="button"
            className={`reports-filter__btn${viewMode === 'active' ? ' reports-filter__btn--active' : ''}`}
            onClick={() => { setViewMode('active'); setSelected(new Set()) }}>
            الطلبات النشطة
          </button>
          <button type="button"
            className={`reports-filter__btn${viewMode === 'archived' ? ' reports-filter__btn--active' : ''}`}
            onClick={() => { setViewMode('archived'); setSelected(new Set()) }}>
            المؤرشفة
          </button>
        </div>

        {/* Filters */}
        <div className="cashier-history__filters">
          <MdFilterList className="cashier-history__filter-icon" />
          <select
            className="inline-edit-input cashier-history__cashier-filter"
            value={selectedCashier}
            onChange={(e) => setSelectedCashier(e.target.value)}
          >
            <option value="all">كل الكاشيرات</option>
            {cashierNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <input
            type="date"
            className="inline-edit-input"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
          {selectedDate && (
            <button type="button" className="btn btn--secondary btn--sm cashier-history__clear-date"
              onClick={() => setSelectedDate('')}>✕</button>
          )}
        </div>

      </div>

      {actionMsg && (
        <p className="form-message form-message--ok" role="status">{actionMsg}</p>
      )}

      {/* ── Summary ── */}
      {!loading && filtered.length > 0 && (
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="stat-card">
            <div className="stat-card__label">إجمالي الطلبات المعروضة</div>
            <div className="stat-card__value">{filtered.length}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card__label">إجمالي الإيرادات</div>
            <div className="stat-card__value">{totalRevenue.toFixed(2)} {cur}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card__label">متوسط الطلب</div>
            <div className="stat-card__value">
              {filtered.length > 0 ? (totalRevenue / filtered.length).toFixed(2) : '0.00'} {cur}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="app-loading">جارٍ التحميل…</p>
      ) : filtered.length === 0 ? (
        <div className="card">
          <p className="report-empty">لا توجد طلبات في هذه الفترة</p>
        </div>
      ) : (
        <>
          {/* Select all */}
          <div className="cashier-history__selection-bar">
            <label className="cashier-history__select-all" htmlFor="select-all">
              <input
                className="table-checkbox"
                type="checkbox"
                id="select-all"
                checked={selected.size === filtered.length && filtered.length > 0}
                onChange={selectAll}
              />
              <span>تحديد الكل ({filtered.length})</span>
            </label>
            {selected.size > 0 && (
              <div className="cashier-history__bulk-actions">
                <span className="cashier-history__selected-count">
                  {selected.size} محدد
                </span>
                {viewMode === 'active' ? (
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => void handleArchive()}>
                    <MdArchive /> أرشفة المحدد
                  </button>
                ) : (
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => void handleUnarchive()}>
                    <MdUnarchive /> إلغاء الأرشفة
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Grouped by date */}
          {sortedDates.map((date) => (
            <div key={date} className="cashier-history__day">
              <div className="cashier-history__day-header">
                <span className="cashier-history__day-date">{date}</span>
                <span className="cashier-history__day-total">
                  {Object.values(grouped[date]!).flat().reduce((s, o) => s + o.total, 0).toFixed(2)} {cur}
                </span>
              </div>

              {Object.entries(grouped[date]!).map(([cashierName, cashierOrders]) => {
                const cashierTotal = cashierOrders.reduce((s, o) => s + o.total, 0)
                const allCashierSelected = cashierOrders.every((o) => selected.has(o.id))

                return (
                  <div key={cashierName} className="cashier-history__cashier">
                    <div className="cashier-history__cashier-header">
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input
                          className="table-checkbox"
                          type="checkbox"
                          checked={allCashierSelected}
                          onChange={() => selectDateCashier(cashierOrders)}
                        />
                        <span className="cashier-history__cashier-name">{cashierName}</span>
                      </label>
                      <span className="cashier-history__cashier-stats">
                        {cashierOrders.length} طلب · {cashierTotal.toFixed(2)} {cur}
                      </span>
                    </div>

                    <table className="data-table cashier-history__table">
                      <thead>
                        <tr>
                          <th style={{ width: '1%' }}></th>
                          <th>رقم الطلب</th>
                          <th>الوقت</th>
                          <th>الإجمالي</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {cashierOrders.map((o) => (
                          <tr key={o.id} className={selected.has(o.id) ? 'cashier-history__row--selected' : ''}>
                            <td>
                              <input
                                className="table-checkbox"
                                type="checkbox"
                                checked={selected.has(o.id)}
                                onChange={() => toggleSelect(o.id)}
                              />
                            </td>
                            <td>
                              <strong>#{orderReference(o)}</strong>
                              {o.noteAr && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>{o.noteAr}</div>
                              )}
                            </td>
                            <td style={{ fontSize: '0.85rem' }}>
                              {new Date(o.completedAt ?? o.createdAt).toLocaleTimeString('ar-EG')}
                            </td>
                            <td><strong style={{ color: 'var(--color-primary)' }}>{o.total.toFixed(2)} {cur}</strong></td>
                            <td>
                              <div className="table-actions">
                                <button type="button" className="btn btn--secondary btn--sm"
                                  onClick={() => void openDetails(o)} disabled={detailsLoading}
                                  aria-label="عرض التفاصيل">
                                  <MdVisibility />
                                </button>
                                <button type="button" className="btn btn--secondary btn--sm"
                                  onClick={() => void reprintOrder(o)}
                                  aria-label="طباعة">
                                  <MdPrint />
                                </button>
                                {viewMode === 'active' ? (
                                  <button type="button" className="btn btn--secondary btn--sm"
                                    onClick={async () => { await archiveOrders([o.id]); await load() }}
                                    aria-label="أرشفة" title="أرشفة">
                                    <MdArchive />
                                  </button>
                                ) : (
                                  <button type="button" className="btn btn--secondary btn--sm"
                                    onClick={async () => { await unarchiveOrders([o.id]); await load() }}
                                    aria-label="إلغاء أرشفة" title="إلغاء أرشفة">
                                    <MdUnarchive />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              })}
            </div>
          ))}
        </>
      )}

      {/* ── Order details modal ── */}
      {details && (
        <div className="modal-overlay" onClick={() => setDetails(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="order-details__header">
              <h2 className="order-details__title">طلب #{orderReference(details.order)}</h2>
              <button type="button" className="order-details__close" onClick={() => setDetails(null)}>✕</button>
            </div>
            <div className="order-details__meta">
              <div className="order-details__meta-row">
                <span className="order-details__meta-label">التاريخ</span>
                <span>{new Date(details.order.completedAt ?? details.order.createdAt).toLocaleString('ar-EG')}</span>
              </div>
              <div className="order-details__meta-row">
                <span className="order-details__meta-label">الكاشير</span>
                <span>{details.order.cashierName}</span>
              </div>
              {details.order.noteAr && (
                <div className="order-details__meta-row">
                  <span className="order-details__meta-label">ملاحظة</span>
                  <span>{details.order.noteAr}</span>
                </div>
              )}
            </div>
            <table className="data-table" style={{ marginTop: 12 }}>
              <thead>
                <tr><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr>
              </thead>
              <tbody>
                {details.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.nameAr}</td>
                    <td>{item.quantity}</td>
                    <td>{item.unitPrice.toFixed(2)} {cur}</td>
                    <td>{item.lineTotal.toFixed(2)} {cur}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="order-details__totals">
              <div className="order-details__total-row">
                <span>الإجمالي</span>
                <strong>{details.order.total.toFixed(2)} {cur}</strong>
              </div>
            </div>
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button type="button" className="btn btn--primary btn--sm"
                onClick={() => void reprintOrder(details.order)}>
                طباعة الإيصال
              </button>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setDetails(null)}>
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
