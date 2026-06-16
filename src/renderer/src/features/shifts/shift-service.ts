/**
 * Shift service — SQLite primary database.
 */
import type { CashDrawerTransaction, InventoryTransaction, Order, Shift } from '@shared/types'
import { COLLECTIONS } from '@shared/constants/collections'
import { cacheDocs, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
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
  expenses: number
  suppliedInventory: Array<InventoryTransaction & { ingredientNameAr: string }>
  usedInventory: Array<InventoryTransaction & { ingredientNameAr: string }>
  cashTransactions: CashDrawerTransaction[]
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

export async function closeShift(shiftId: string, closedBy: string, closingCash?: number): Promise<void> {
  const now = Date.now()
  await patchCachedShifts([shiftId], {
    status: 'closed',
    closedAt: now,
    closedBy,
    closingCash,
    updatedAt: now
  })

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
  const [allOrders, inventoryTransactions, cashTransactions, ingredients] = await Promise.all([
    listOrders(2000),
    listInventoryTransactions(),
    listCashDrawerTransactions(),
    listIngredients()
  ])

  const orders = allOrders
    .filter((o) => orderBelongsToShift(o, shift))
    .sort((a, b) => a.createdAt - b.createdAt)
  const orderIds = new Set(orders.map((o) => o.id))
  const completedOrders = orders.filter((o) => o.status === 'completed')
  const cancelledOrders = orders.filter((o) => o.status === 'cancelled')

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
  const drawerTotal = shiftCashTransactions.reduce((sum, tx) => sum + tx.amount, 0)

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

  // Cash reconciliation
  const openingCash = shift.openingCash ?? 0
  const cashExpenses = shiftCashTransactions
    .filter((tx) => tx.amount < 0)
    .reduce((sum, tx) => sum + tx.amount, 0) // negative sum
  const expectedCash = openingCash + cashRevenue + cashExpenses
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
    expenses,
    suppliedInventory: suppliedInventory.map(withName),
    usedInventory: usedInventory.map(withName),
    cashTransactions: shiftCashTransactions
  }
}
