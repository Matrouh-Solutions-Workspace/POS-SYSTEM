/**
 * Shift service — SQLite primary database.
 */
import type {
  AppSettings,
  AppUser,
  CashRoundingTransaction,
  CashDrawerTransaction,
  InventoryTransaction,
  Order,
  OrderItem,
  Payment,
  Shift,
  ShiftAccessResult,
  ShiftClosureRecord
} from '@shared/types'
import { COLLECTIONS, SETTINGS_DOC_ID } from '@shared/constants/collections'
import { cacheDocs, getCachedDoc, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { dbBatch } from '@renderer/lib/db/sqlite-db'
import { generateId } from '@renderer/lib/utils/id'
import { listOrders } from '../orders/order-service'
import { listInventoryTransactions, listIngredients } from '../inventory/inventory-service'
import { listCashDrawerTransactions } from '../cash/cash-service'

export interface ShiftSummary {
  shift: Shift
  orders: Order[]
  completedOrders: Order[]
  cancelledOrders: Order[]
  revenue: number
  drawerTotal: number
  /** Expected cash = openingCash + cash sales - cash expenses */
  expectedCash: number
  /** Actual cash counted at close (closingCash) */
  actualCash?: number
  /** Difference: actualCash - expectedCash */
  cashDifference?: number
  cashRevenue: number
  cardRevenue: number
  roundingAdjustments: number
  expenses: number
  itemSummary: Array<{
    key: string
    nameAr: string
    sizeLabelAr?: string
    unitLabel?: string
    quantity: number
    total: number
  }>
  suppliedInventory: Array<InventoryTransaction & { ingredientNameAr: string }>
  usedInventory: Array<InventoryTransaction & { ingredientNameAr: string }>
  cashTransactions: CashDrawerTransaction[]
}

export interface ShiftClosurePreview {
  shift: Shift
  pendingOrders: Order[]
  incompletePaymentOrders: Order[]
  openingCash: number
  cashSales: number
  cardSales: number
  cashRefunds: number
  cardRefunds: number
  cashAdjustments: number
  roundingAdjustments: number
  expectedCash: number
  ordersCount: number
  totalSales: number
}

async function patchCachedShifts(shiftIds: string[], patch: Partial<Shift>): Promise<void> {
  const cached = await getCachedDocs<Shift>(COLLECTIONS.shifts)
  const updates = cached
    .filter((s) => shiftIds.includes(s.id))
    .map((s) => ({ ...s, ...patch, updatedAt: Date.now() }))
  if (updates.length) await cacheDocs(COLLECTIONS.shifts, updates)
}

function normalizeIdentity(value?: string): string {
  return value?.trim().toLowerCase() ?? ''
}

function isInShiftWindow(timestamp: number | undefined, shift: Shift): boolean {
  if (!timestamp) return false
  const end = shift.closedAt ?? Date.now()
  return timestamp >= shift.openedAt && timestamp <= end
}

function orderMatchesShiftCashier(order: Order, shift: Shift): boolean {
  if (order.cashierId === shift.cashierId) return true
  if (
    normalizeIdentity(order.cashierCode) &&
    normalizeIdentity(order.cashierCode) === normalizeIdentity(shift.cashierCode)
  ) return true
  const orderName = normalizeIdentity(order.cashierName)
  return !!orderName && orderName === normalizeIdentity(shift.cashierName)
}

function orderBelongsToShift(order: Order, shift: Shift): boolean {
  if (order.shiftId === shift.id) return true
  if (order.shiftId) return false
  return isInShiftWindow(order.createdAt, shift) && orderMatchesShiftCashier(order, shift)
}

function transactionBelongsToShift(
  tx: Pick<CashDrawerTransaction | InventoryTransaction, 'shiftId' | 'createdAt' | 'createdBy'> & {
    orderId?: string
    referenceId?: string
  },
  shift: Shift,
  orderIds: Set<string>
): boolean {
  if (tx.shiftId === shift.id) return true
  if (tx.shiftId) return false
  if (tx.orderId && orderIds.has(tx.orderId)) return true
  if (tx.referenceId && orderIds.has(tx.referenceId)) return true
  return tx.createdBy === shift.cashierId && isInShiftWindow(tx.createdAt, shift)
}

export async function listShifts(includeArchived = false): Promise<Shift[]> {
  const shifts = await getCachedDocs<Shift>(COLLECTIONS.shifts)
  const sorted = shifts.sort((a, b) => b.openedAt - a.openedAt)
  return includeArchived ? sorted : sorted.filter((s) => !s.archived)
}

export async function getOpenShiftForCashier(cashierId: string): Promise<Shift | null> {
  const shifts = await getCachedDocs<Shift>(COLLECTIONS.shifts)
  return shifts.find((s) => s.cashierId === cashierId && s.status === 'open') ?? null
}

export async function ensureOpenShift(params: {
  cashierId: string
  cashierName: string
  cashierCode?: string
  openingCash?: number
}): Promise<Shift> {
  const cashier = await getCachedDoc<AppUser>(COLLECTIONS.users, params.cashierId)
  const access: ShiftAccessResult = cashier?.role === 'cashier'
    ? await import('./work-shift-service').then(({ validateUserShiftAccess }) =>
        validateUserShiftAccess(params.cashierId)
      )
    : { allowed: true }
  if (!access.allowed) {
    throw new Error(access.reason ?? 'لا يمكن استخدام نقطة البيع خارج وقت وردية العمل')
  }

  const existing = await getOpenShiftForCashier(params.cashierId)
  if (existing) return existing

  const now = Date.now()
  const shift: Shift = {
    id: generateId(),
    cashierId: params.cashierId,
    cashierName: params.cashierName,
    cashierCode: params.cashierCode,
    status: 'open',
    archived: false,
    openingCash: params.openingCash,
    workShiftId: access.workShift?.id,
    workShiftName: access.workShift?.name,
    assignmentId: access.assignment?.id,
    scheduledStartAt: access.scheduledStartAt,
    scheduledEndAt: access.scheduledEndAt,
    overtimeStartedAt: access.overtimeStartedAt,
    openedAt: now,
    createdAt: now,
    updatedAt: now
  }
  await cacheDocs(COLLECTIONS.shifts, [shift])

  // Audit
  void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
    logAudit({
      action: 'shift_opened',
      actorId: params.cashierId,
      actorName: params.cashierName,
      targetId: shift.id,
      targetType: 'shift',
      detailAr: `فتح شيفت — افتتاح نقدي: ${params.openingCash?.toFixed(2) ?? '—'}`
    })
  )

  return shift
}

export async function getShiftClosurePreview(shift: Shift): Promise<ShiftClosurePreview> {
  const [allOrders, payments, cashTransactions, roundingRecords] = await Promise.all([
    getCachedDocs<Order>(COLLECTIONS.orders),
    getCachedDocs<Payment>(COLLECTIONS.payments),
    listCashDrawerTransactions(),
    getCachedDocs<CashRoundingTransaction>(COLLECTIONS.cashRoundingTransactions)
  ])
  const orders = allOrders.filter((order) => orderBelongsToShift(order, shift))
  const orderIds = new Set(orders.map((order) => order.id))
  const pendingOrders = orders.filter((order) =>
    order.status !== 'cancelled' &&
    (order.status === 'draft' || order.paymentStatus === 'unpaid')
  )
  const incompletePaymentOrders = orders.filter((order) => {
    if (order.status !== 'completed' || order.total <= 0) return false
    const paid = payments
      .filter((payment) => payment.orderId === order.id)
      .reduce((sum, payment) => sum + payment.amount, 0)
    return paid + 0.01 < order.total
  })
  const shiftPayments = payments.filter((payment) => orderIds.has(payment.orderId))
  const netCashSales = shiftPayments
    .filter((payment) => payment.method === 'cash' && payment.amount > 0)
    .reduce((sum, payment) => sum + payment.amount, 0)
  const roundingAmount = roundingRecords
    .filter((record) => record.shiftId === shift.id)
    .reduce((sum, record) => sum + record.differenceAmount, 0)
  const cashSales = netCashSales + roundingAmount
  const roundingAdjustments = -roundingAmount
  const cardSales = shiftPayments
    .filter((payment) => payment.method === 'card' && payment.amount > 0)
    .reduce((sum, payment) => sum + payment.amount, 0)
  const recordedCashRefunds = Math.abs(shiftPayments
    .filter((payment) => payment.method === 'cash' && payment.amount < 0)
    .reduce((sum, payment) => sum + payment.amount, 0))
  const cardRefunds = Math.abs(shiftPayments
    .filter((payment) => payment.method === 'card' && payment.amount < 0)
    .reduce((sum, payment) => sum + payment.amount, 0))
  const negativePaymentOrderIds = new Set(
    shiftPayments.filter((payment) => payment.amount < 0).map((payment) => payment.orderId)
  )
  const legacyCashRefunds = orders
    .filter((order) =>
      order.status === 'cancelled' &&
      !negativePaymentOrderIds.has(order.id) &&
      (order.paymentStatus === 'paid' || order.paymentStatus === 'split')
    )
    .reduce((sum, order) => {
      const negativeDrawer = Math.abs(cashTransactions
        .filter((transaction) => transaction.orderId === order.id && transaction.amount < 0)
        .reduce((total, transaction) => total + transaction.amount, 0))
      if (!negativeDrawer) return sum
      const positiveCashPayments = shiftPayments
        .filter((payment) =>
          payment.orderId === order.id && payment.method === 'cash' && payment.amount > 0
        )
        .reduce((total, payment) => total + payment.amount, 0)
      const refundOrder = !!order.refundOfOrderId || order.total < 0 || order.orderCode?.startsWith('RFD-') === true
      return sum + (refundOrder ? negativeDrawer : (positiveCashPayments || negativeDrawer))
    }, 0)
  const cashRefunds = recordedCashRefunds + legacyCashRefunds
  const cashAdjustments = cashTransactions
    .filter((transaction) =>
      transactionBelongsToShift(transaction, shift, orderIds) && !transaction.orderId
    )
    .reduce((sum, transaction) => sum + transaction.amount, 0)
  const openingCash = shift.openingCash ?? 0
  const completed = orders.filter((order) => order.status === 'completed' && order.total > 0)
  const refundAmount = Math.abs(
    orders.filter((order) =>
      !!order.refundOfOrderId || order.total < 0 || order.orderCode?.startsWith('RFD-') === true
    ).reduce((sum, order) => sum + order.total, 0)
  )
  return {
    shift,
    pendingOrders,
    incompletePaymentOrders,
    openingCash,
    cashSales,
    cardSales,
    cashRefunds,
    cardRefunds,
    cashAdjustments,
    roundingAdjustments,
    expectedCash: openingCash + cashSales - cashRefunds + cashAdjustments + roundingAdjustments,
    ordersCount: completed.length,
    totalSales: completed.reduce((sum, order) => sum + order.total, 0) - refundAmount
  }
}

export async function closeShift(
  shiftId: string,
  closedBy: string,
  closingCash?: number,
  options?: { differenceReason?: string; approvedBy?: string }
): Promise<void> {
  const now = Date.now()
  const current = await getCachedDoc<Shift>(COLLECTIONS.shifts, shiftId)
  if (!current || current.status === 'closed') return
  const settings = await getCachedDoc<AppSettings>(COLLECTIONS.settings, SETTINGS_DOC_ID)
  const performanceEnabled = settings?.employeePerformanceTrackingEnabled === true
  const closure = await getShiftClosurePreview(current)
  if (performanceEnabled) {
    if (closure.pendingOrders.length) {
      throw new Error(`لا يمكن إغلاق الشيفت: يوجد ${closure.pendingOrders.length} طلب معلق أو غير مدفوع.`)
    }
    if (closure.incompletePaymentOrders.length) {
      throw new Error(`لا يمكن إغلاق الشيفت: يوجد ${closure.incompletePaymentOrders.length} طلب بمدفوعات غير مكتملة.`)
    }
    if (closingCash === undefined || !Number.isFinite(closingCash) || closingCash < 0) {
      throw new Error('يجب إدخال مبلغ الكاش الفعلي قبل إغلاق الشيفت.')
    }
  }
  const overtimeMinutes = current?.scheduledEndAt
    ? Math.max(0, Math.ceil((now - current.scheduledEndAt) / 60_000))
    : undefined
  const cashDifference = closingCash !== undefined ? closingCash - closure.expectedCash : undefined
  if (performanceEnabled && cashDifference && Math.abs(cashDifference) >= 0.01 && !options?.differenceReason?.trim()) {
    throw new Error('اكتب سبب فرق الكاش قبل تأكيد إغلاق الشيفت.')
  }
  const closedShift: Shift = {
    ...current,
    status: 'closed',
    closedAt: now,
    closedBy,
    closingCash,
    overtimeStartedAt: overtimeMinutes ? current?.scheduledEndAt : current?.overtimeStartedAt,
    overtimeMinutes,
    totalSales: closure.totalSales,
    transactionCount: closure.ordersCount,
    expectedCash: closure.expectedCash,
    cashDifference,
    updatedAt: now
  }
  const closureRecord: ShiftClosureRecord | null = performanceEnabled && closingCash !== undefined ? {
    id: generateId(),
    shiftSessionId: current.id,
    userId: current.cashierId,
    openingCash: closure.openingCash,
    cashSales: closure.cashSales,
    cardSales: closure.cardSales,
    refunds: closure.cashRefunds + closure.cardRefunds,
    cashAdjustments: closure.cashAdjustments,
    roundingAdjustments: closure.roundingAdjustments,
    expectedCash: closure.expectedCash,
    actualCash: closingCash,
    difference: cashDifference ?? 0,
    differenceType: Math.abs(cashDifference ?? 0) < 0.01
      ? 'balanced'
      : (cashDifference ?? 0) < 0 ? 'shortage' : 'surplus',
    differenceReason: options?.differenceReason?.trim() || undefined,
    approvedBy: options?.approvedBy,
    approvedAt: options?.approvedBy ? now : undefined,
    ordersCount: closure.ordersCount,
    closedAt: now,
    createdAt: now,
    updatedAt: now
  } : null
  await dbBatch([
    { collection: COLLECTIONS.shifts, id: closedShift.id, data: closedShift, op: 'set' },
    ...(closureRecord ? [{
      collection: COLLECTIONS.shiftClosureRecords,
      id: closureRecord.id,
      data: closureRecord,
      op: 'set' as const
    }] : [])
  ])
  {
    const record = await import('./work-shift-service').then(({ saveOvertimeForClosedSession }) =>
      saveOvertimeForClosedSession(closedShift)
    )
    if (record) {
      void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
        logAudit({
          action: 'overtime_recorded',
          actorId: closedBy,
          actorName: closedBy,
          targetId: record.id,
          targetType: 'shift',
          detailAr: `تسجيل ${record.durationMinutes} دقيقة عمل إضافي`
        })
      )
    }
  }

  // Audit
  void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
    logAudit({
      action: 'shift_closed',
      actorId: closedBy,
      actorName: closedBy,
      targetId: shiftId,
      targetType: 'shift',
      detailAr: `إغلاق شيفت — رصيد الإغلاق: ${closingCash?.toFixed(2) ?? '—'}`
    })
  )
}

export async function archiveShifts(shiftIds: string[]): Promise<void> {
  await patchCachedShifts(shiftIds, { archived: true, updatedAt: Date.now() })
}

export async function unarchiveShifts(shiftIds: string[]): Promise<void> {
  await patchCachedShifts(shiftIds, { archived: false, updatedAt: Date.now() })
}

export async function getUnarchivedShiftCount(): Promise<number> {
  const shifts = await listShifts(false)
  return shifts.length
}

export async function getShiftSummary(shift: Shift): Promise<ShiftSummary> {
  const [allOrders, allOrderItems, inventoryTransactions, cashTransactions, ingredients, roundingRecords] = await Promise.all([
    listOrders(2000),
    getCachedDocs<OrderItem>(COLLECTIONS.orderItems),
    listInventoryTransactions(),
    listCashDrawerTransactions(),
    listIngredients(),
    getCachedDocs<CashRoundingTransaction>(COLLECTIONS.cashRoundingTransactions)
  ])

  const orders = allOrders
    .filter((o) => orderBelongsToShift(o, shift))
    .sort((a, b) => a.createdAt - b.createdAt)
  const orderIds = new Set(orders.map((o) => o.id))
  const completedOrders = orders.filter((o) => o.status === 'completed')
  const cancelledOrders = orders.filter((o) => o.status === 'cancelled')
  const completedOrderIds = new Set(completedOrders.map((o) => o.id))
  const itemSummaryMap = new Map<string, ShiftSummary['itemSummary'][number]>()
  for (const item of allOrderItems.filter((line) => completedOrderIds.has(line.orderId))) {
    const key = [item.menuItemId, item.nameAr, item.sizeLabelAr ?? '', item.unitLabel ?? ''].join('|')
    const existing = itemSummaryMap.get(key)
    if (existing) {
      existing.quantity += item.quantity
      existing.total += item.lineTotal
    } else {
      itemSummaryMap.set(key, {
        key,
        nameAr: item.nameAr,
        sizeLabelAr: item.sizeLabelAr,
        unitLabel: item.unitLabel,
        quantity: item.quantity,
        total: item.lineTotal
      })
    }
  }
  const itemSummary = [...itemSummaryMap.values()].sort((a, b) => b.quantity - a.quantity || a.nameAr.localeCompare(b.nameAr, 'ar'))

  const shiftInventory = inventoryTransactions.filter((tx) =>
    transactionBelongsToShift(tx, shift, orderIds)
  )
  const suppliedInventory = shiftInventory.filter((tx) => tx.type === 'purchase')
  const usedInventory = shiftInventory.filter(
    (tx) => tx.type === 'sale' || tx.type === 'waste'
  )
  const shiftCashTransactions = cashTransactions.filter((tx) =>
    transactionBelongsToShift(tx, shift, orderIds)
  )

  const ingredientMap = new Map(ingredients.map((i) => [i.id, i.nameAr]))
  const withName = (tx: InventoryTransaction): InventoryTransaction & { ingredientNameAr: string } => ({
    ...tx,
    ingredientNameAr:
      (tx as InventoryTransaction & { ingredientNameAr?: string }).ingredientNameAr?.trim() ||
      ingredientMap.get(tx.ingredientId) ||
      tx.ingredientId
  })

  const revenue = completedOrders.reduce((sum, o) => sum + o.total, 0)
  const expenses = shiftCashTransactions
    .filter((tx) => tx.type !== 'sale' && tx.amount < 0)
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0)
  // Payment method breakdown from order payments
  const allPayments = await getCachedDocs<{ orderId: string; amount: number; method: string }>(
    COLLECTIONS.payments
  )
  const shiftOrderIds = new Set(orders.map((o) => o.id))
  const shiftPayments = allPayments.filter((p) => shiftOrderIds.has(p.orderId))
  const cashRevenue = shiftPayments
    .filter((p) => p.method === 'cash')
    .reduce((sum, p) => sum + p.amount, 0)
  const cardRevenue = shiftPayments
    .filter((p) => p.method === 'card')
    .reduce((sum, p) => sum + p.amount, 0)
  const roundingAdjustments = -roundingRecords
    .filter((record) => record.shiftId === shift.id)
    .reduce((sum, record) => sum + record.differenceAmount, 0)

  // Cash reconciliation
  const openingCash = shift.openingCash ?? 0
  const cashExpenses = shiftCashTransactions
    .filter((tx) => !tx.orderId && tx.amount < 0)
    .reduce((sum, tx) => sum + tx.amount, 0) // negative sum
  const cashAdditions = shiftCashTransactions
    .filter((tx) => !tx.orderId && tx.amount > 0)
    .reduce((sum, tx) => sum + tx.amount, 0)
  const drawerTotal = cashRevenue + cashExpenses + cashAdditions
  const expectedCash = openingCash + drawerTotal
  const actualCash = shift.closingCash
  const cashDifference = actualCash !== undefined ? actualCash - expectedCash : undefined

  return {
    shift,
    orders,
    completedOrders,
    cancelledOrders,
    revenue,
    drawerTotal,
    expectedCash,
    actualCash,
    cashDifference,
    cashRevenue,
    cardRevenue,
    roundingAdjustments,
    expenses,
    itemSummary,
    suppliedInventory: suppliedInventory.map(withName),
    usedInventory: usedInventory.map(withName),
    cashTransactions: shiftCashTransactions
  }
}
