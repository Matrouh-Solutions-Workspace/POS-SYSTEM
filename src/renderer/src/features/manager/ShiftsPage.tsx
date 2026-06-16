import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Shift } from '@shared/types'
import {
  archiveShifts,
  closeShift,
  getShiftSummary,
  listShifts,
  unarchiveShifts,
  type ShiftSummary
} from '@renderer/features/shifts/shift-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { MdArchive, MdLock, MdRefresh, MdUnarchive } from 'react-icons/md'

type ShiftViewMode = 'active' | 'archived'

function orderStatusLabel(status: string): string {
  if (status === 'completed') return 'مكتمل'
  if (status === 'cancelled') return 'ملغي'
  return 'مفتوح'
}

function paymentStatusLabel(status?: string): string {
  return status === 'unpaid' ? 'غير مدفوع' : 'مدفوع'
}

function orderPlaceLabel(order: ShiftSummary['orders'][number]): string {
  if (order.orderType !== 'dine_in') return 'تيك أواي'
  return [order.tableCategoryAr, order.tableNameAr].filter(Boolean).join(' / ') || 'صالة'
}

export function ShiftsPage(): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [allShifts, setAllShifts] = useState<Shift[]>([])
  const [viewMode, setViewMode] = useState<ShiftViewMode>('active')
  const [selected, setSelected] = useState<ShiftSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setAllShifts(await listShifts(true))
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const counts = useMemo(() => ({
    active: allShifts.filter((s) => !s.archived).length,
    archived: allShifts.filter((s) => !!s.archived).length
  }), [allShifts])

  const shifts = useMemo(() => (
    allShifts.filter((shift) => viewMode === 'archived' ? !!shift.archived : !shift.archived)
  ), [allShifts, viewMode])

  useEffect(() => {
    if (selected && !shifts.some((shift) => shift.id === selected.shift.id)) {
      setSelected(null)
    }
  }, [selected, shifts])

  async function openSummary(shift: Shift): Promise<void> {
    setSelected(await getShiftSummary(shift))
  }

  async function handleClose(shift: Shift): Promise<void> {
    await closeShift(shift.id, user.id)
    setMessage('تم تقفيل الشيفت')
    await load()
  }

  async function handleArchive(shift: Shift): Promise<void> {
    await archiveShifts([shift.id])
    setMessage('تمت أرشفة الشيفت')
    setSelected(null)
    await load()
  }

  async function handleUnarchive(shift: Shift): Promise<void> {
    await unarchiveShifts([shift.id])
    setMessage('تم إلغاء أرشفة الشيفت')
    setSelected(null)
    await load()
  }

  if (loading) return <p className="app-loading">جاري التحميل...</p>

  return (
    <div className="shifts-page">
      {message && <p className="form-message form-message--ok">{message}</p>}
      <div className="card">
        <div className="reports-filter__options" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={`reports-filter__btn${viewMode === 'active' ? ' reports-filter__btn--active' : ''}`}
            onClick={() => { setViewMode('active'); setSelected(null) }}
          >
            الشيفتات النشطة ({counts.active})
          </button>
          <button
            type="button"
            className={`reports-filter__btn${viewMode === 'archived' ? ' reports-filter__btn--active' : ''}`}
            onClick={() => { setViewMode('archived'); setSelected(null) }}
          >
            الشيفتات المؤرشفة ({counts.archived})
          </button>
        </div>

        <h2 className="card__title">
          {viewMode === 'archived' ? 'الشيفتات المؤرشفة' : 'الشيفتات غير المؤرشفة'} ({shifts.length})
        </h2>

        <table className="data-table">
          <thead>
            <tr>
              <th>الكاشير</th>
              <th>الكود</th>
              <th>الحالة</th>
              <th>البداية</th>
              <th>النهاية</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shifts.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', color: 'var(--color-muted)' }}>
                  لا توجد شيفتات في هذا القسم
                </td>
              </tr>
            ) : shifts.map((shift) => (
              <tr key={shift.id}>
                <td>{shift.cashierName}</td>
                <td dir="ltr">{shift.cashierCode ?? '--'}</td>
                <td>{shift.status === 'open' ? 'مفتوح' : 'مقفل'}</td>
                <td>{new Date(shift.openedAt).toLocaleString('ar-EG')}</td>
                <td>{shift.closedAt ? new Date(shift.closedAt).toLocaleString('ar-EG') : '-'}</td>
                <td>
                  <div className="table-actions">
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => void openSummary(shift)}>
                      <MdRefresh /> عرض
                    </button>
                    {shift.status === 'open' && viewMode === 'active' && (
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => void handleClose(shift)}>
                        <MdLock /> تقفيل
                      </button>
                    )}
                    {shift.status === 'closed' && (
                      viewMode === 'archived' ? (
                        <button type="button" className="btn btn--secondary btn--sm" onClick={() => void handleUnarchive(shift)}>
                          <MdUnarchive /> إلغاء الأرشفة
                        </button>
                      ) : (
                        <button type="button" className="btn btn--secondary btn--sm" onClick={() => void handleArchive(shift)}>
                          <MdArchive /> أرشفة
                        </button>
                      )
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="card">
          <h2 className="card__title">ملخص شيفت {selected.shift.cashierName}</h2>
          <div className="stats-grid">
            <div className="stat-card"><div className="stat-card__label">إجمالي الإيراد</div><div className="stat-card__value">{selected.revenue.toFixed(2)}</div></div>
            <div className="stat-card"><div className="stat-card__label">فلوس الدرج الكلي</div><div className="stat-card__value">{selected.drawerTotal.toFixed(2)}</div></div>
            <div className="stat-card"><div className="stat-card__label">إيراد نقدي</div><div className="stat-card__value">{selected.cashRevenue.toFixed(2)}</div></div>
            <div className="stat-card"><div className="stat-card__label">إيراد بطاقة</div><div className="stat-card__value">{selected.cardRevenue.toFixed(2)}</div></div>
            <div className="stat-card"><div className="stat-card__label">المصروفات</div><div className="stat-card__value">{selected.expenses.toFixed(2)}</div></div>
            <div className="stat-card"><div className="stat-card__label">كل الطلبات</div><div className="stat-card__value">{selected.orders.length}</div></div>
            <div className="stat-card"><div className="stat-card__label">طلبات مكتملة</div><div className="stat-card__value">{selected.completedOrders.length}</div></div>
            <div className="stat-card"><div className="stat-card__label">طلبات ملغية</div><div className="stat-card__value">{selected.cancelledOrders.length}</div></div>
            <div className="stat-card"><div className="stat-card__label">توريدات مخزون</div><div className="stat-card__value">{selected.suppliedInventory.length}</div></div>
          </div>

          {/* Cash reconciliation */}
          <div className="card" style={{ background: '#f0fdf4', borderColor: '#22c55e', marginBottom: 12 }}>
            <h3 className="card__title" style={{ borderColor: '#22c55e' }}>تسوية الكاش</h3>
            <div className="stats-grid" style={{ marginBottom: 0 }}>
              <div className="stat-card">
                <div className="stat-card__label">كاش بداية الشيفت</div>
                <div className="stat-card__value">{(selected.shift.openingCash ?? 0).toFixed(2)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-card__label">الكاش المتوقع</div>
                <div className="stat-card__value">{selected.expectedCash.toFixed(2)}</div>
              </div>
              {selected.actualCash !== undefined && (
                <div className="stat-card">
                  <div className="stat-card__label">الكاش الفعلي</div>
                  <div className="stat-card__value">{selected.actualCash.toFixed(2)}</div>
                </div>
              )}
              {selected.cashDifference !== undefined && (
                <div className="stat-card" style={{ borderColor: Math.abs(selected.cashDifference) < 0.01 ? '#22c55e' : '#f97316' }}>
                  <div className="stat-card__label">الفرق</div>
                  <div className="stat-card__value" style={{ color: Math.abs(selected.cashDifference) < 0.01 ? 'var(--color-success)' : '#ea580c', fontSize: '1.2rem' }}>
                    {selected.cashDifference >= 0 ? '+' : ''}{selected.cashDifference.toFixed(2)}
                    {Math.abs(selected.cashDifference) < 0.01 && ' ✓'}
                  </div>
                </div>
              )}
            </div>
          </div>

          <h3 className="section-title">أوردرات الشيفت</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>الأوردر</th>
                <th>الوقت</th>
                <th>النوع / الترابيزة</th>
                <th>الحالة</th>
                <th>الدفع</th>
                <th>الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {selected.orders.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--color-muted)' }}>
                    لا توجد أوردرات في هذا الشيفت
                  </td>
                </tr>
              ) : selected.orders.map((order) => (
                <tr key={order.id}>
                  <td dir="ltr">{order.orderCode ?? order.orderNumber}</td>
                  <td>{new Date(order.createdAt).toLocaleString('ar-EG')}</td>
                  <td>{orderPlaceLabel(order)}</td>
                  <td>{orderStatusLabel(order.status)}</td>
                  <td>{paymentStatusLabel(order.paymentStatus)}</td>
                  <td>{order.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="section-title">الأوردرات الملغية</h3>
          <table className="data-table">
            <thead><tr><th>الأوردر</th><th>السبب</th><th>الإجمالي</th></tr></thead>
            <tbody>
              {selected.cancelledOrders.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'center', color: 'var(--color-muted)' }}>
                    لا توجد أوردرات ملغية
                  </td>
                </tr>
              ) : selected.cancelledOrders.map((o) => (
                <tr key={o.id}><td dir="ltr">{o.orderCode ?? o.orderNumber}</td><td>{o.cancelReasonAr ?? '-'}</td><td>{o.total.toFixed(2)}</td></tr>
              ))}
            </tbody>
          </table>

          <h3 className="section-title">المخزون المستخدم</h3>
          <table className="data-table">
            <thead><tr><th>المكون</th><th>الكمية</th><th>الوحدة</th></tr></thead>
            <tbody>
              {selected.usedInventory.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'center', color: 'var(--color-muted)' }}>
                    لا توجد حركات مخزون مستخدمة
                  </td>
                </tr>
              ) : selected.usedInventory.map((tx) => (
                <tr key={tx.id}><td>{tx.ingredientNameAr ?? tx.ingredientId}</td><td>{tx.quantity.toFixed(2)}</td><td>{tx.unit}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
