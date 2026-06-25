import type {
  AppSettings,
  AppUser,
  EmployeeActivityLog,
  EmployeePerformanceDaily,
  Order,
  OrderItem,
  Payment,
  Shift,
  ShiftClosureRecord
} from '@shared/types'
import { COLLECTIONS, SETTINGS_DOC_ID } from '@shared/constants/collections'
import { cacheDocs, getCachedDoc, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { actorAuditName, type AuditActor } from '@renderer/features/audit/audit-service'

export interface EmployeePerformanceRow {
  user: AppUser
  totalSales: number
  ordersCount: number
  completedOrders: number
  cancelledOrders: number
  refundedOrders: number
  averageOrderValue: number
  averageProcessingMinutes: number
  itemsSold: number
  cashPayments: number
  cardPayments: number
  refundAmount: number
  discountAmount: number
  cashDifference: number
  workedMinutes: number
  rankingScore: number
}

export interface PerformanceFilters {
  userId?: string
  workShiftId?: string
  from?: string
  to?: string
}

function dateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function range(filters?: PerformanceFilters, trackingStartedAt = 0): { fromAt: number; toAt: number } {
  return {
    fromAt: Math.max(
      trackingStartedAt,
      filters?.from ? new Date(`${filters.from}T00:00:00`).getTime() : 0
    ),
    toAt: filters?.to ? new Date(`${filters.to}T23:59:59.999`).getTime() : Number.MAX_SAFE_INTEGER
  }
}

function isRefund(order: Order): boolean {
  return !!order.refundOfOrderId || order.total < 0 || order.orderCode?.startsWith('RFD-') === true
}

export async function isPerformanceTrackingEnabled(): Promise<boolean> {
  const settings = await getCachedDoc<AppSettings>(COLLECTIONS.settings, SETTINGS_DOC_ID)
  return settings?.employeePerformanceTrackingEnabled === true
}

async function getPerformanceSettings(): Promise<AppSettings | null> {
  return getCachedDoc<AppSettings>(COLLECTIONS.settings, SETTINGS_DOC_ID)
}

export async function listEmployeeActivity(filters?: {
  userId?: string
  from?: string
  to?: string
}): Promise<EmployeeActivityLog[]> {
  const settings = await getPerformanceSettings()
  if (settings?.employeePerformanceTrackingEnabled !== true) return []
  const { fromAt, toAt } = range(filters, settings.employeePerformanceTrackingStartedAt)
  const logs = await getCachedDocs<EmployeeActivityLog>(COLLECTIONS.employeeActivityLogs)
  return logs
    .filter((log) =>
      (!filters?.userId || log.userId === filters.userId) &&
      log.createdAt >= fromAt &&
      log.createdAt <= toAt
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 1000)
}

export async function listShiftClosureRecords(filters?: PerformanceFilters): Promise<ShiftClosureRecord[]> {
  const settings = await getPerformanceSettings()
  if (settings?.employeePerformanceTrackingEnabled !== true) return []
  const { fromAt, toAt } = range(filters, settings.employeePerformanceTrackingStartedAt)
  const shifts = filters?.workShiftId
    ? await getCachedDocs<Shift>(COLLECTIONS.shifts)
    : []
  const allowedSessionIds = new Set(
    shifts.filter((shift) => shift.workShiftId === filters?.workShiftId).map((shift) => shift.id)
  )
  const records = await getCachedDocs<ShiftClosureRecord>(COLLECTIONS.shiftClosureRecords)
  return records
    .filter((record) =>
      (!filters?.userId || record.userId === filters.userId) &&
      (!filters?.workShiftId || allowedSessionIds.has(record.shiftSessionId)) &&
      record.closedAt >= fromAt &&
      record.closedAt <= toAt
    )
    .sort((a, b) => b.closedAt - a.closedAt)
}

export async function approveShiftDifference(
  closureId: string,
  actor: AuditActor
): Promise<void> {
  const record = await getCachedDoc<ShiftClosureRecord>(COLLECTIONS.shiftClosureRecords, closureId)
  if (!record) throw new Error('سجل الإغلاق غير موجود')
  const updated: ShiftClosureRecord = {
    ...record,
    approvedBy: actor.id,
    approvedAt: Date.now(),
    updatedAt: Date.now()
  }
  await cacheDocs(COLLECTIONS.shiftClosureRecords, [updated])
  void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
    logAudit({
      action: 'shift_difference_approved',
      actorId: actor.id,
      actorName: actorAuditName(actor),
      targetId: closureId,
      targetType: 'shift',
      detailAr: `اعتماد فرق كاش بقيمة ${record.difference.toFixed(2)}`
    })
  )
}

export async function getEmployeePerformance(
  filters?: PerformanceFilters
): Promise<EmployeePerformanceRow[]> {
  const settings = await getPerformanceSettings()
  if (settings?.employeePerformanceTrackingEnabled !== true) return []
  const { fromAt, toAt } = range(filters, settings.employeePerformanceTrackingStartedAt)
  const [users, allOrders, items, payments, shifts, closures] = await Promise.all([
    getCachedDocs<AppUser>(COLLECTIONS.users),
    getCachedDocs<Order>(COLLECTIONS.orders),
    getCachedDocs<OrderItem>(COLLECTIONS.orderItems),
    getCachedDocs<Payment>(COLLECTIONS.payments),
    getCachedDocs<Shift>(COLLECTIONS.shifts),
    getCachedDocs<ShiftClosureRecord>(COLLECTIONS.shiftClosureRecords)
  ])

  const filteredShifts = shifts.filter((shift) =>
    (!filters?.userId || shift.cashierId === filters.userId) &&
    (!filters?.workShiftId || shift.workShiftId === filters.workShiftId) &&
    shift.openedAt >= fromAt &&
    shift.openedAt <= toAt
  )
  const shiftIds = new Set(filteredShifts.map((shift) => shift.id))
  const orders = allOrders.filter((order) =>
    (!filters?.userId || order.cashierId === filters.userId) &&
    order.createdAt >= fromAt &&
    order.createdAt <= toAt &&
    (!filters?.workShiftId || (!!order.shiftId && shiftIds.has(order.shiftId)))
  )
  const orderMap = new Map(orders.map((order) => [order.id, order]))
  const orderIds = new Set(orderMap.keys())
  const relevantItems = items.filter((item) => orderIds.has(item.orderId))
  const relevantPayments = payments.filter((payment) => orderIds.has(payment.orderId))
  const closureByUser = new Map<string, ShiftClosureRecord[]>()
  for (const record of closures.filter((record) =>
    record.closedAt >= fromAt &&
    record.closedAt <= toAt &&
    (!filters?.userId || record.userId === filters.userId) &&
    (!filters?.workShiftId || shiftIds.has(record.shiftSessionId))
  )) {
    const list = closureByUser.get(record.userId) ?? []
    list.push(record)
    closureByUser.set(record.userId, list)
  }

  const employees = users.filter((user) =>
    user.active &&
    user.role !== 'manager' &&
    (!filters?.userId || user.id === filters.userId)
  )
  const rawRows = employees.map((user) => {
    const userOrders = orders.filter((order) => order.cashierId === user.id)
    const normalOrders = userOrders.filter((order) => !isRefund(order))
    const completed = normalOrders.filter((order) => order.status === 'completed')
    const cancelled = normalOrders.filter((order) => order.status === 'cancelled')
    const refunds = userOrders.filter(isRefund)
    const completedIds = new Set(completed.map((order) => order.id))
    const userPayments = relevantPayments.filter((payment) =>
      orderMap.get(payment.orderId)?.cashierId === user.id
    )
    const userShifts = filteredShifts.filter((shift) => shift.cashierId === user.id)
    const userClosures = closureByUser.get(user.id) ?? []
    const processingValues = completed
      .filter((order) => order.completedAt)
      .map((order) => Math.max(0, ((order.completedAt ?? order.updatedAt) - order.createdAt) / 60_000))
    const grossSales = completed.reduce((sum, order) => sum + order.total, 0)
    const refundAmount = Math.abs(refunds.reduce((sum, order) => sum + order.total, 0))
    const totalSales = grossSales - refundAmount
    return {
      user,
      totalSales,
      ordersCount: normalOrders.length,
      completedOrders: completed.length,
      cancelledOrders: cancelled.length,
      refundedOrders: refunds.length,
      averageOrderValue: completed.length ? totalSales / completed.length : 0,
      averageProcessingMinutes: processingValues.length
        ? processingValues.reduce((sum, value) => sum + value, 0) / processingValues.length
        : 0,
      itemsSold: relevantItems
        .filter((item) => completedIds.has(item.orderId))
        .reduce((sum, item) => sum + item.quantity, 0),
      cashPayments: userPayments
        .filter((payment) => payment.method === 'cash')
        .reduce((sum, payment) => sum + payment.amount, 0),
      cardPayments: userPayments
        .filter((payment) => payment.method === 'card')
        .reduce((sum, payment) => sum + payment.amount, 0),
      refundAmount,
      discountAmount: completed.reduce((sum, order) => sum + (order.discountAmount ?? 0), 0),
      cashDifference: userClosures.reduce((sum, record) => sum + record.difference, 0),
      workedMinutes: userShifts.reduce((sum, shift) =>
        sum + Math.max(0, Math.floor(((shift.closedAt ?? Date.now()) - shift.openedAt) / 60_000)), 0
      ),
      rankingScore: 0
    }
  })

  const maxSales = Math.max(1, ...rawRows.map((row) => Math.max(0, row.totalSales)))
  const maxOrders = Math.max(1, ...rawRows.map((row) => row.completedOrders))
  const maxWorked = Math.max(1, ...rawRows.map((row) => row.workedMinutes))
  const rows = rawRows.map((row) => {
    const refundRate = row.completedOrders ? row.refundedOrders / row.completedOrders : 0
    const varianceRate = row.totalSales ? Math.min(1, Math.abs(row.cashDifference) / row.totalSales) : 0
    const score = (
      (Math.max(0, row.totalSales) / maxSales) * 45 +
      (row.completedOrders / maxOrders) * 20 +
      (1 - varianceRate) * 20 +
      (1 - Math.min(1, refundRate)) * 10 +
      (row.workedMinutes / maxWorked) * 5
    )
    return { ...row, rankingScore: Math.round(score * 10) / 10 }
  }).sort((a, b) => b.rankingScore - a.rankingScore || b.totalSales - a.totalSales)

  await persistDailySnapshots(orders, relevantItems, relevantPayments, filteredShifts, closures)
  return rows
}

async function persistDailySnapshots(
  orders: Order[],
  items: OrderItem[],
  payments: Payment[],
  shifts: Shift[],
  closures: ShiftClosureRecord[]
): Promise<void> {
  const existingSnapshots = await getCachedDocs<EmployeePerformanceDaily>(COLLECTIONS.employeePerformanceDaily)
  const existingMap = new Map(existingSnapshots.map((snapshot) => [snapshot.id, snapshot]))
  const keys = new Set(orders.map((order) => `${order.cashierId}|${dateKey(order.createdAt)}`))
  shifts.forEach((shift) => keys.add(`${shift.cashierId}|${dateKey(shift.openedAt)}`))
  const now = Date.now()
  const snapshots: EmployeePerformanceDaily[] = []
  for (const key of keys) {
    const [userId, date] = key.split('|')
    if (!userId || !date) continue
    const dayOrders = orders.filter((order) => order.cashierId === userId && dateKey(order.createdAt) === date)
    const normal = dayOrders.filter((order) => !isRefund(order))
    const completed = normal.filter((order) => order.status === 'completed')
    const refunds = dayOrders.filter(isRefund)
    const completedIds = new Set(completed.map((order) => order.id))
    const dayPayments = payments.filter((payment) => {
      const order = orders.find((candidate) => candidate.id === payment.orderId)
      return order?.cashierId === userId && dateKey(order.createdAt) === date
    })
    const dayShifts = shifts.filter((shift) => shift.cashierId === userId && dateKey(shift.openedAt) === date)
    const dayClosures = closures.filter((record) => record.userId === userId && dateKey(record.closedAt) === date)
    const processing = completed
      .filter((order) => order.completedAt)
      .map((order) => ((order.completedAt ?? order.updatedAt) - order.createdAt) / 60_000)
    const refundAmount = Math.abs(refunds.reduce((sum, order) => sum + order.total, 0))
    const totalSales = completed.reduce((sum, order) => sum + order.total, 0) - refundAmount
    const id = `${userId}_${date}`
    snapshots.push({
      id,
      userId,
      date,
      totalSales,
      ordersCount: normal.length,
      completedOrders: completed.length,
      cancelledOrders: normal.filter((order) => order.status === 'cancelled').length,
      refundedOrders: refunds.length,
      averageOrderValue: completed.length ? totalSales / completed.length : 0,
      averageProcessingMinutes: processing.length
        ? processing.reduce((sum, value) => sum + value, 0) / processing.length
        : 0,
      itemsSold: items.filter((item) => completedIds.has(item.orderId)).reduce((sum, item) => sum + item.quantity, 0),
      cashPayments: dayPayments.filter((payment) => payment.method === 'cash').reduce((sum, payment) => sum + payment.amount, 0),
      cardPayments: dayPayments.filter((payment) => payment.method === 'card').reduce((sum, payment) => sum + payment.amount, 0),
      refundAmount,
      discountAmount: completed.reduce((sum, order) => sum + (order.discountAmount ?? 0), 0),
      cashDifference: dayClosures.reduce((sum, record) => sum + record.difference, 0),
      workedMinutes: dayShifts.reduce((sum, shift) =>
        sum + Math.max(0, Math.floor(((shift.closedAt ?? Date.now()) - shift.openedAt) / 60_000)), 0
      ),
      createdAt: existingMap.get(id)?.createdAt ?? now,
      updatedAt: now
    })
  }
  if (snapshots.length) await cacheDocs(COLLECTIONS.employeePerformanceDaily, snapshots)
}
