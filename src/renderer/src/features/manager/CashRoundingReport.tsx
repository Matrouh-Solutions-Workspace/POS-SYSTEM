import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppUser, CashRoundingTransaction, Order, Shift } from '@shared/types'
import { COLLECTIONS } from '@shared/constants/collections'
import { MdRefresh } from 'react-icons/md'
import { listAllAccounts } from '@renderer/features/auth/auth-service'
import { getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import {
  listCashRoundingTransactions,
  listRoundingShifts
} from '@renderer/features/rounding/cash-rounding-service'
import { orderReference } from '@shared/services/order-reference'

export function CashRoundingReport(): React.ReactElement {
  const [records, setRecords] = useState<CashRoundingTransaction[]>([])
  const [allRecords, setAllRecords] = useState<CashRoundingTransaction[]>([])
  const [users, setUsers] = useState<AppUser[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [userId, setUserId] = useState('')
  const [shiftId, setShiftId] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const loadBase = useCallback(async () => {
    const [accounts, roundingShifts, orderDocs, rounding] = await Promise.all([
      listAllAccounts(),
      listRoundingShifts(),
      getCachedDocs<Order>(COLLECTIONS.orders),
      listCashRoundingTransactions()
    ])
    setUsers(accounts)
    setShifts(roundingShifts)
    setOrders(orderDocs)
    setAllRecords(rounding)
  }, [])

  const load = useCallback(async () => {
    setRecords(await listCashRoundingTransactions({
      userId: userId || undefined,
      shiftId: shiftId || undefined,
      deviceId: deviceId || undefined,
      from: from || undefined,
      to: to || undefined
    }))
  }, [deviceId, from, shiftId, to, userId])

  useEffect(() => { void loadBase() }, [loadBase])
  useEffect(() => { void load() }, [load])

  const orderMap = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders])
  const devices = useMemo(
    () => [...new Set(allRecords.map((record) => record.deviceId))].sort(),
    [allRecords]
  )

  return (
    <section className="card" aria-labelledby="cash-rounding-report-title">
      <h2 id="cash-rounding-report-title" className="card__title">تقرير تقريب الدفع النقدي</h2>
      <div className="settings-form-grid" style={{ marginBottom: 14 }}>
        <label className="field"><span>الموظف</span><select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">كل الموظفين</option>{users.map((user) => <option key={user.id} value={user.id}>{user.username}</option>)}</select></label>
        <label className="field"><span>جلسة الشيفت</span><select value={shiftId} onChange={(event) => setShiftId(event.target.value)}><option value="">كل الجلسات</option>{shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.cashierName} - {new Date(shift.openedAt).toLocaleString('ar-EG')}</option>)}</select></label>
        <label className="field"><span>الجهاز / الفرع</span><select value={deviceId} onChange={(event) => setDeviceId(event.target.value)}><option value="">كل الأجهزة</option>{devices.map((device) => <option key={device} value={device}>{device}</option>)}</select></label>
        <label className="field"><span>من</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="field"><span>إلى</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <div className="form-actions"><button type="button" className="btn btn--secondary" onClick={() => void load()}><MdRefresh /> تحديث</button></div>
      </div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-card__label">عدد عمليات التقريب</div><div className="stat-card__value">{records.length}</div></div>
        <div className="stat-card"><div className="stat-card__label">صافي فروق التقريب</div><div className="stat-card__value">{records.reduce((sum, record) => sum + record.differenceAmount, 0).toFixed(2)}</div></div>
      </div>
      <table className="data-table">
        <thead><tr><th>الطلب</th><th>النوع</th><th>المستخدم</th><th>الجهاز</th><th>الأصلي</th><th>النهائي</th><th>الفرق</th><th>السبب</th><th>التاريخ</th></tr></thead>
        <tbody>
          {records.length === 0 ? <tr><td colSpan={9}>لا توجد عمليات تقريب في الفترة المحددة.</td></tr> : records.map((record) => {
            const order = orderMap.get(record.orderId)
            const type = record.differenceAmount < 0
              ? 'عكس'
              : order?.status === 'cancelled'
                ? 'مطبق على طلب ملغي'
                : 'تطبيق'
            return (
              <tr key={record.id}>
                <td>{order ? `#${orderReference(order)}` : record.orderId}</td>
                <td>{type}</td>
                <td>{record.username}</td>
                <td>{record.deviceId}</td>
                <td>{record.originalAmount.toFixed(2)}</td>
                <td>{record.finalAmount.toFixed(2)}</td>
                <td>{record.differenceAmount.toFixed(2)}</td>
                <td>{record.reason}</td>
                <td>{new Date(record.createdAt).toLocaleString('ar-EG')}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
