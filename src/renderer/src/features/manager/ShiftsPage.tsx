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
import { getSettings } from '@renderer/features/orders/order-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { MdArchive, MdLock, MdPrint, MdRefresh, MdUnarchive } from 'react-icons/md'
import { WorkShiftManagement } from './WorkShiftManagement'
import { EmployeePerformanceManagement } from './EmployeePerformanceManagement'
import { CashRoundingReport } from './CashRoundingReport'

type ShiftViewMode = 'active' | 'archived'

function shiftOrderTypeSummary(summary: ShiftSummary): Record<'dine_in' | 'delivery' | 'takeaway', number> {
  return summary.completedOrders.reduce((acc, order) => {
    if (order.orderType === 'dine_in') acc.dine_in += 1
    else if (order.orderType === 'delivery') acc.delivery += 1
    else acc.takeaway += 1
    return acc
  }, { dine_in: 0, delivery: 0, takeaway: 0 })
}

function formatQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(3).replace(/0+$/g, '').replace(/\.$/g, '')
}

function buildShiftReceiptHtml(summary: ShiftSummary, currency: string): string {
  const typeCounts = shiftOrderTypeSummary(summary)
  const itemRows = summary.itemSummary.map((item) => `
    <tr>
      <td>${item.nameAr}${item.sizeLabelAr ? `<br/><small>${item.sizeLabelAr}</small>` : ''}</td>
      <td>${formatQty(item.quantity)}${item.unitLabel ? ` ${item.unitLabel}` : ''}</td>
      <td>${item.total.toFixed(2)} ${currency}</td>
    </tr>
  `).join('')
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8" />
    <style>
      @page { size: 80mm 297mm; margin: 0; }
      body { font-family: Tahoma, Arial, sans-serif; font-size: 12px; margin: 8px; color: #000; }
      h1, h2 { text-align: center; margin: 4px 0; }
      .line { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th, td { border-bottom: 1px dashed #999; padding: 3px; text-align: right; }
      .total { border-top: 2px solid #000; margin-top: 6px; padding-top: 6px; font-weight: 900; }
    </style></head><body>
      <h1>ملخص الشيفت</h1>
      <h2>${summary.shift.cashierName}</h2>
      <div class="line"><span>البداية</span><span>${new Date(summary.shift.openedAt).toLocaleString('ar-EG')}</span></div>
      <div class="line"><span>النهاية</span><span>${summary.shift.closedAt ? new Date(summary.shift.closedAt).toLocaleString('ar-EG') : '-'}</span></div>
      <div class="line"><span>المتوقع في الدرج</span><span>${summary.expectedCash.toFixed(2)} ${currency}</span></div>
      <div class="line"><span>دخل البطاقة المتوقع</span><span>${summary.cardRevenue.toFixed(2)} ${currency}</span></div>
      <div class="line"><span>تسويات التقريب</span><span>${summary.roundingAdjustments.toFixed(2)} ${currency}</span></div>
      <div class="line total"><span>إجمالي الإيراد</span><span>${summary.revenue.toFixed(2)} ${currency}</span></div>
      <hr />
      <div class="line"><span>صالة</span><span>${typeCounts.dine_in}</span></div>
      <div class="line"><span>دليفري</span><span>${typeCounts.delivery}</span></div>
      <div class="line"><span>تيك أواي</span><span>${typeCounts.takeaway}</span></div>
      <h2>الأصناف المباعة</h2>
      <table><thead><tr><th>الصنف</th><th>الكمية</th><th>الإجمالي</th></tr></thead><tbody>${itemRows}</tbody></table>
    </body></html>`
}

export function ShiftsPage(): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [allShifts, setAllShifts] = useState<Shift[]>([])
  const [viewMode, setViewMode] = useState<ShiftViewMode>('active')
  const [selected, setSelected] = useState<ShiftSummary | null>(null)
  const [performanceEnabled, setPerformanceEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [shifts, settings] = await Promise.all([listShifts(true), getSettings()])
    setAllShifts(shifts)
    setPerformanceEnabled(settings.employeePerformanceTrackingEnabled === true)
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
    if (performanceEnabled) {
      setMessage('عند تفعيل تتبع الأداء يجب إغلاق الشيفت من واجهة الكاشير بعد إدخال الكاش الفعلي والتسوية.')
      return
    }
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

  async function printSelectedShift(): Promise<void> {
    if (!selected) return
    const settings = await getSettings()
    const result = await window.electronAPI.printReceipt(buildShiftReceiptHtml(selected, settings.currencySymbol))
    setMessage(result.ok ? 'تم إرسال ملخص الشيفت للطباعة' : (result.error ?? 'فشل طباعة ملخص الشيفت'))
  }

  if (loading) return <p className="app-loading">جاري التحميل...</p>

  return (
    <div className="shifts-page">
      <WorkShiftManagement />
      <EmployeePerformanceManagement />
      <CashRoundingReport />
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
                    {shift.status === 'open' && viewMode === 'active' && !performanceEnabled && (
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
          <div className="page-toolbar" style={{ justifyContent: 'space-between' }}>
            <h2 className="card__title" style={{ margin: 0 }}>ملخص شيفت {selected.shift.cashierName}</h2>
            <button type="button" className="btn btn--secondary" onClick={() => void printSelectedShift()}>
              <MdPrint /> طباعة ملخص الشيفت
            </button>
          </div>
          <div className="stats-grid">
            <div className="stat-card"><div className="stat-card__label">إجمالي الإيراد</div><div className="stat-card__value">{selected.revenue.toFixed(2)}</div></div>
            <div className="stat-card"><div className="stat-card__label">فلوس الدرج الكلي</div><div className="stat-card__value">{selected.drawerTotal.toFixed(2)}</div></div>
            <div className="stat-card"><div className="stat-card__label">إيراد نقدي</div><div className="stat-card__value">{selected.cashRevenue.toFixed(2)}</div></div>
            <div className="stat-card"><div className="stat-card__label">إيراد بطاقة</div><div className="stat-card__value">{selected.cardRevenue.toFixed(2)}</div></div>
            <div className="stat-card"><div className="stat-card__label">تسويات التقريب</div><div className="stat-card__value">{selected.roundingAdjustments.toFixed(2)}</div></div>
            <div className="stat-card"><div className="stat-card__label">المصروفات</div><div className="stat-card__value">{selected.expenses.toFixed(2)}</div></div>
            <div className="stat-card"><div className="stat-card__label">كل الطلبات</div><div className="stat-card__value">{selected.orders.length}</div></div>
            <div className="stat-card"><div className="stat-card__label">طلبات مكتملة</div><div className="stat-card__value">{selected.completedOrders.length}</div></div>
            <div className="stat-card"><div className="stat-card__label">طلبات ملغية</div><div className="stat-card__value">{selected.cancelledOrders.length}</div></div>
            <div className="stat-card"><div className="stat-card__label">توريدات مخزون</div><div className="stat-card__value">{selected.suppliedInventory.length}</div></div>
          </div>
          {(() => {
            const typeCounts = shiftOrderTypeSummary(selected)
            return (
              <div className="stats-grid">
                <div className="stat-card"><div className="stat-card__label">طلبات الصالة</div><div className="stat-card__value">{typeCounts.dine_in}</div></div>
                <div className="stat-card"><div className="stat-card__label">طلبات الدليفري</div><div className="stat-card__value">{typeCounts.delivery}</div></div>
                <div className="stat-card"><div className="stat-card__label">طلبات التيك أواي</div><div className="stat-card__value">{typeCounts.takeaway}</div></div>
                <div className="stat-card"><div className="stat-card__label">المتوقع في الدرج</div><div className="stat-card__value">{selected.expectedCash.toFixed(2)}</div></div>
                <div className="stat-card"><div className="stat-card__label">دخل البطاقة المتوقع</div><div className="stat-card__value">{selected.cardRevenue.toFixed(2)}</div></div>
              </div>
            )
          })()}

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

          <h3 className="section-title">الأصناف المباعة في الشيفت</h3>
          <table className="data-table">
            <thead>
              <tr><th>الصنف</th><th>الكمية</th><th>الإجمالي</th></tr>
            </thead>
            <tbody>
              {selected.itemSummary.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'center', color: 'var(--color-muted)' }}>
                    لا توجد أصناف مباعة في هذا الشيفت
                  </td>
                </tr>
              ) : selected.itemSummary.map((item) => (
                <tr key={item.key}>
                  <td>{item.nameAr}{item.sizeLabelAr ? ` - ${item.sizeLabelAr}` : ''}</td>
                  <td>{formatQty(item.quantity)}{item.unitLabel ? ` ${item.unitLabel}` : ''}</td>
                  <td>{item.total.toFixed(2)}</td>
                </tr>
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
