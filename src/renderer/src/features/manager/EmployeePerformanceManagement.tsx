import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AppUser,
  EmployeeActivityLog,
  EmployeeWorkShift,
  ShiftClosureRecord
} from '@shared/types'
import { MdCheck, MdRefresh } from 'react-icons/md'
import { listAllAccounts } from '@renderer/features/auth/auth-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { getSettings, updateSettings } from '@renderer/features/orders/order-service'
import {
  approveShiftDifference,
  getEmployeePerformance,
  listEmployeeActivity,
  listShiftClosureRecords,
  type EmployeePerformanceRow
} from '@renderer/features/performance/performance-service'
import { listWorkShifts } from '@renderer/features/shifts/work-shift-service'

type PerformanceTab = 'ranking' | 'activity' | 'closures'

const ACTIVITY_LABELS: Record<string, string> = {
  login: 'تسجيل دخول',
  logout: 'تسجيل خروج',
  shift_opened: 'فتح شيفت',
  shift_closed: 'إغلاق شيفت',
  order_created: 'إنشاء طلب',
  order_updated: 'تعديل طلب',
  order_paid: 'تحصيل طلب',
  order_cancelled: 'إلغاء طلب',
  order_refunded: 'استرداد طلب',
  discount_applied: 'تطبيق خصم',
  inventory_purchase: 'توريد مخزون',
  inventory_waste: 'تسجيل هدر',
  inventory_adjustment: 'تسوية مخزون',
  cash_in: 'إضافة نقدية',
  cash_out: 'سحب نقدي',
  cash_rounding_applied: 'تقريب دفع نقدي'
}

function minutesLabel(value: number): string {
  const hours = Math.floor(value / 60)
  const minutes = Math.round(value % 60)
  return hours ? `${hours}س ${minutes}د` : `${minutes}د`
}

export function EmployeePerformanceManagement(): React.ReactElement {
  const actor = useAuthStore((state) => state.user)!
  const [enabled, setEnabled] = useState(false)
  const [tab, setTab] = useState<PerformanceTab>('ranking')
  const [users, setUsers] = useState<AppUser[]>([])
  const [workShifts, setWorkShifts] = useState<EmployeeWorkShift[]>([])
  const [rows, setRows] = useState<EmployeePerformanceRow[]>([])
  const [activity, setActivity] = useState<EmployeeActivityLog[]>([])
  const [closures, setClosures] = useState<ShiftClosureRecord[]>([])
  const [userId, setUserId] = useState('')
  const [workShiftId, setWorkShiftId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users])

  const loadBase = useCallback(async () => {
    const [settings, accounts, shifts] = await Promise.all([
      getSettings(),
      listAllAccounts(),
      listWorkShifts()
    ])
    setEnabled(settings.employeePerformanceTrackingEnabled === true)
    setUsers(accounts)
    setWorkShifts(shifts)
  }, [])

  const loadReports = useCallback(async () => {
    setLoading(true)
    const filters = {
      userId: userId || undefined,
      workShiftId: workShiftId || undefined,
      from: from || undefined,
      to: to || undefined
    }
    const [performance, logs, closureRecords] = await Promise.all([
      getEmployeePerformance(filters),
      listEmployeeActivity({ userId: filters.userId, from: filters.from, to: filters.to }),
      listShiftClosureRecords(filters)
    ])
    setRows(performance)
    setActivity(logs)
    setClosures(closureRecords)
    setLoading(false)
  }, [from, to, userId, workShiftId])

  useEffect(() => { void loadBase() }, [loadBase])
  useEffect(() => {
    if (enabled) void loadReports()
  }, [enabled, loadReports])

  async function toggleEnabled(): Promise<void> {
    const next = !enabled
    await updateSettings({
      employeePerformanceTrackingEnabled: next,
      employeePerformanceTrackingStartedAt: next ? Date.now() : undefined
    }, actor)
    setEnabled(next)
    setMessage(next ? 'تم تفعيل تتبع أداء الموظفين' : 'تم إيقاف جمع بيانات الأداء')
    if (!next) {
      setRows([])
      setActivity([])
      setClosures([])
    }
  }

  async function approve(record: ShiftClosureRecord): Promise<void> {
    await approveShiftDifference(record.id, actor)
    setMessage('تم اعتماد فرق الكاش')
    await loadReports()
  }

  function handleTabKeys(event: React.KeyboardEvent<HTMLDivElement>): void {
    const tabs: PerformanceTab[] = ['ranking', 'activity', 'closures']
    const current = tabs.indexOf(tab)
    let next = current
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    setTab(tabs[next]!)
  }

  return (
    <section className="card" aria-labelledby="employee-performance-title">
      <div className="page-toolbar" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 id="employee-performance-title" className="card__title" style={{ margin: 0 }}>أداء الموظفين ودقة إغلاق الشيفت</h2>
          <p className="modal-hint">المبيعات، سرعة تنفيذ الطلبات، طرق الدفع، المرتجعات ودقة الكاش من العمليات الفعلية.</p>
        </div>
        <label className="field field--checkbox" style={{ margin: 0 }}>
          <input type="checkbox" checked={enabled} onChange={() => void toggleEnabled()} />
          <span>{enabled ? 'التتبع مفعّل' : 'التتبع متوقف'}</span>
        </label>
      </div>
      {message && <p className="form-message form-message--ok">{message}</p>}

      {!enabled ? (
        <p className="modal-hint">لن يتم جمع نشاط جديد، وتظل نقطة البيع تعمل دون قيود أداء أو تسوية إلزامية.</p>
      ) : (
        <>
          <div className="settings-form-grid" style={{ marginBottom: 16 }}>
            <label className="field"><span>الموظف</span><select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">كل الموظفين</option>{users.map((user) => <option key={user.id} value={user.id}>{user.username}</option>)}</select></label>
            <label className="field"><span>الوردية</span><select value={workShiftId} onChange={(event) => setWorkShiftId(event.target.value)}><option value="">كل الورديات</option>{workShifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}</select></label>
            <label className="field"><span>من</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label className="field"><span>إلى</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
            <div className="form-actions"><button type="button" className="btn btn--secondary" onClick={() => void loadReports()} disabled={loading}><MdRefresh /> تحديث</button></div>
          </div>

          <div className="inner-tabs" role="tablist" onKeyDown={handleTabKeys}>
            {([
              ['ranking', 'الأداء والترتيب'],
              ['activity', 'نشاط الموظفين'],
              ['closures', 'فروقات وإغلاق الكاش']
            ] as Array<[PerformanceTab, string]>).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                tabIndex={tab === key ? 0 : -1}
                className={`inner-tabs__btn${tab === key ? ' inner-tabs__btn--active' : ''}`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'ranking' && (
            <table className="data-table">
              <thead><tr><th>#</th><th>الموظف</th><th>النقاط</th><th>صافي المبيعات</th><th>الطلبات</th><th>متوسط الطلب</th><th>الأصناف</th><th>وقت التنفيذ</th><th>مرتجعات</th><th>خصومات</th><th>فرق الكاش</th><th>ساعات العمل</th></tr></thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={12}>لا توجد بيانات في الفترة المحددة.</td></tr> : rows.map((row, index) => (
                  <tr key={row.user.id}>
                    <td>{index + 1}</td>
                    <td>{row.user.username}</td>
                    <td>{row.rankingScore.toFixed(1)}</td>
                    <td>{row.totalSales.toFixed(2)}</td>
                    <td>{row.completedOrders} / {row.ordersCount}</td>
                    <td>{row.averageOrderValue.toFixed(2)}</td>
                    <td>{row.itemsSold.toFixed(2)}</td>
                    <td>{row.averageProcessingMinutes.toFixed(1)}د</td>
                    <td>{row.refundedOrders} ({row.refundAmount.toFixed(2)})</td>
                    <td>{row.discountAmount.toFixed(2)}</td>
                    <td>{row.cashDifference.toFixed(2)}</td>
                    <td>{minutesLabel(row.workedMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'activity' && (
            <table className="data-table">
              <thead><tr><th>المستخدم</th><th>العملية</th><th>الجهاز</th><th>المرجع</th><th>التفاصيل</th><th>الوقت</th></tr></thead>
              <tbody>
                {activity.length === 0 ? <tr><td colSpan={6}>لا يوجد نشاط مسجل في الفترة المحددة.</td></tr> : activity.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.username}</td>
                    <td>{ACTIVITY_LABELS[entry.actionType] ?? entry.actionType.replaceAll('_', ' ')}</td>
                    <td>{entry.deviceId}</td>
                    <td>{entry.referenceId ?? '-'}</td>
                    <td>{entry.detailAr}</td>
                    <td>{new Date(entry.createdAt).toLocaleString('ar-EG')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'closures' && (
            <table className="data-table">
              <thead><tr><th>المستخدم</th><th>الافتتاح</th><th>كاش</th><th>بطاقة</th><th>مرتجعات</th><th>تسويات</th><th>تقريب</th><th>المتوقع</th><th>الفعلي</th><th>الفرق</th><th>السبب</th><th>الاعتماد</th><th>التاريخ</th></tr></thead>
              <tbody>
                {closures.length === 0 ? <tr><td colSpan={13}>لا توجد سجلات إغلاق في الفترة المحددة.</td></tr> : closures.map((record) => (
                  <tr key={record.id}>
                    <td>{userMap.get(record.userId)?.username ?? record.userId}</td>
                    <td>{record.openingCash.toFixed(2)}</td>
                    <td>{record.cashSales.toFixed(2)}</td>
                    <td>{record.cardSales.toFixed(2)}</td>
                    <td>{record.refunds.toFixed(2)}</td>
                    <td>{record.cashAdjustments.toFixed(2)}</td>
                    <td>{(record.roundingAdjustments ?? 0).toFixed(2)}</td>
                    <td>{record.expectedCash.toFixed(2)}</td>
                    <td>{record.actualCash.toFixed(2)}</td>
                    <td>{record.difference.toFixed(2)}</td>
                    <td>{record.differenceReason ?? '-'}</td>
                    <td>{record.approvedBy ? (userMap.get(record.approvedBy)?.username ?? 'تم الاعتماد') : (
                      Math.abs(record.difference) < 0.01 ? 'متزن' : <button type="button" className="btn btn--secondary btn--sm" onClick={() => void approve(record)}><MdCheck /> اعتماد</button>
                    )}</td>
                    <td>{new Date(record.closedAt).toLocaleString('ar-EG')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

        </>
      )}
    </section>
  )
}
