import { listOrders, getOrderItems } from '../orders/order-service'
import type { InventoryBatch, MenuItem, Payment, Recipe } from '@shared/types'
import { COLLECTIONS } from '@shared/constants/collections'
import { getCachedDocs } from '@renderer/lib/offline/sqlite-cache'

export interface DailySalesReport {
  dateKey: string
  orderCount: number
  totalSales: number
  avgOrder: number
}

export interface TopItem {
  nameAr: string
  quantity: number
  revenue: number
}

export interface CashierStat {
  cashierId: string
  cashierName: string
  orderCount: number
  totalSales: number
}

export interface PaymentMethodReport {
  method: 'cash' | 'card' | 'other'
  transactionCount: number
  salesAmount: number
  paidAmount: number
  changeAmount: number
}

export interface ProductProfitabilityReport {
  menuItemId: string
  nameAr: string
  sellingPrice: number
  cost: number
  profit: number
  marginPercent: number
  ingredients: Array<{ ingredientId: string; nameAr: string; quantity: number; cost: number }>
}

export interface ReportData {
  daily: DailySalesReport[]
  topItems: TopItem[]
  cashiers: CashierStat[]
  paymentMethods: PaymentMethodReport[]
  profitability: ProductProfitabilityReport[]
  filterOptions: {
    shifts: Array<{ id: string; label: string }>
    devices: string[]
  }
  summary: {
    totalOrders: number
    totalRevenue: number
    avgOrderValue: number
    todayOrders: number
    todayRevenue: number
    weekRevenue: number
    bestDay: { dateKey: string; totalSales: number } | null
  }
}

export type DateRange = 'today' | 'week' | 'month' | 'year' | 'all'

export function getRangeBounds(range: DateRange): { from: number; to: number } {
  const now = Date.now()
  const startOfDay = (ts: number): number => {
    const d = new Date(ts)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const to = now
  switch (range) {
    case 'today':
      return { from: startOfDay(now), to }
    case 'week':
      return { from: now - 7 * 86400000, to }
    case 'month':
      return { from: now - 30 * 86400000, to }
    case 'year':
      return { from: now - 365 * 86400000, to }
    case 'all':
    default:
      return { from: 0, to }
  }
}

function dateKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

export async function getFullReport(
  range: DateRange = 'all',
  filters?: { employeeId?: string; shiftId?: string; paymentMethod?: string; deviceId?: string }
): Promise<ReportData> {
  const orders = await listOrders(1000)
  const { from, to } = getRangeBounds(range)

  // All completed orders (unfiltered) for summary cards like todayOrders / weekRevenue
  const allCompleted = orders.filter((o) => o.status === 'completed')

  // Filtered completed orders for the selected range
  const completed = allCompleted.filter((o) => {
    const t = o.completedAt ?? o.createdAt
    return t >= from && t <= to &&
      (!filters?.employeeId || o.cashierId === filters.employeeId) &&
      (!filters?.shiftId || o.shiftId === filters.shiftId)
  })

  const today = dateKey(Date.now())
  const weekAgo = Date.now() - 7 * 86400000

  // ── Daily breakdown ───────────────────────────────────────────────────
  const byDay = new Map<string, DailySalesReport>()
  for (const o of completed) {
    const key = dateKey(o.completedAt ?? o.createdAt)
    const existing = byDay.get(key) ?? { dateKey: key, orderCount: 0, totalSales: 0, avgOrder: 0 }
    existing.orderCount += 1
    existing.totalSales += o.total
    byDay.set(key, existing)
  }
  const daily = Array.from(byDay.values())
    .map((r) => ({ ...r, avgOrder: r.orderCount > 0 ? r.totalSales / r.orderCount : 0 }))
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey))

  // ── Cashier breakdown ─────────────────────────────────────────────────
  const byCashier = new Map<string, CashierStat>()
  for (const o of completed) {
    const existing = byCashier.get(o.cashierId) ?? {
      cashierId: o.cashierId,
      cashierName: o.cashierName,
      orderCount: 0,
      totalSales: 0
    }
    existing.orderCount += 1
    existing.totalSales += o.total
    byCashier.set(o.cashierId, existing)
  }
  const cashiers = Array.from(byCashier.values())
    .sort((a, b) => b.totalSales - a.totalSales)

  // ── Top items ─────────────────────────────────────────────────────────
  const itemMap = new Map<string, TopItem>()
  await Promise.all(
    completed.slice(0, 200).map(async (o) => {
      const items = await getOrderItems(o.id)
      for (const item of items) {
        const existing = itemMap.get(item.menuItemId) ?? {
          nameAr: item.nameAr,
          quantity: 0,
          revenue: 0
        }
        existing.quantity += item.quantity
        existing.revenue += item.lineTotal
        itemMap.set(item.menuItemId, existing)
      }
    })
  )
  const topItems = Array.from(itemMap.values())
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10)

  const orderIds = new Set(completed.map((order) => order.id))
  const payments = (await getCachedDocs<Payment>(COLLECTIONS.payments))
    .filter((payment) =>
      orderIds.has(payment.orderId) &&
      (!filters?.paymentMethod || payment.method === filters.paymentMethod) &&
      (!filters?.deviceId || payment.deviceId === filters.deviceId)
    )
  const paymentMap = new Map<string, PaymentMethodReport>()
  for (const payment of payments) {
    const method = payment.method === 'cash' || payment.method === 'card' ? payment.method : 'other'
    const current = paymentMap.get(method) ?? {
      method,
      transactionCount: 0,
      salesAmount: 0,
      paidAmount: 0,
      changeAmount: 0
    }
    current.transactionCount += 1
    current.salesAmount += payment.amount
    current.paidAmount += payment.paidAmount ?? payment.amount
    current.changeAmount += payment.changeAmount ?? 0
    paymentMap.set(method, current)
  }
  const paymentMethods = Array.from(paymentMap.values())

  const [menuItems, recipes, batches, ingredients] = await Promise.all([
    getCachedDocs<MenuItem>(COLLECTIONS.menuItems),
    getCachedDocs<Recipe>(COLLECTIONS.recipes),
    getCachedDocs<InventoryBatch>(COLLECTIONS.inventoryBatches),
    getCachedDocs<{ id: string; nameAr: string }>(COLLECTIONS.ingredients)
  ])
  const ingredientName = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient.nameAr]))
  function fifoCost(ingredientId: string, requestedQuantity: number): number {
    let remaining = Math.abs(requestedQuantity)
    let cost = 0
    const available = batches
      .filter((batch) => batch.ingredientId === ingredientId && batch.remainingQuantity > 0)
      .sort((a, b) => a.receivedAt - b.receivedAt)
    for (const batch of available) {
      if (remaining <= 0.000001) break
      const used = Math.min(remaining, batch.remainingQuantity)
      cost += used * batch.unitCost
      remaining -= used
    }
    return cost
  }
  const recipeById = new Map(recipes.map((recipe) => [recipe.id, recipe]))
  const profitability = menuItems.filter((item) => item.active).map((item) => {
    const recipe = recipeById.get(item.recipeId)
    const lines = item.linkedIngredientId
      ? [{ ingredientId: item.linkedIngredientId, quantity: 1 }]
      : (recipe?.lines ?? [])
    const breakdown = lines.map((line) => ({
      ingredientId: line.ingredientId,
      nameAr: ingredientName.get(line.ingredientId) ?? line.ingredientId,
      quantity: line.quantity,
      cost: fifoCost(line.ingredientId, line.quantity)
    }))
    const cost = breakdown.reduce((sum, line) => sum + line.cost, 0)
    const profit = item.price - cost
    return {
      menuItemId: item.id,
      nameAr: item.nameAr,
      sellingPrice: item.price,
      cost,
      profit,
      marginPercent: item.price > 0 ? profit / item.price * 100 : 0,
      ingredients: breakdown
    }
  }).sort((a, b) => b.profit - a.profit)

  // ── Summary stats (always based on filtered range) ────────────────────
  const totalRevenue = completed.reduce((s, o) => s + o.total, 0)
  const todayOrders = allCompleted.filter((o) => dateKey(o.completedAt ?? o.createdAt) === today).length
  const todayRevenue = allCompleted
    .filter((o) => dateKey(o.completedAt ?? o.createdAt) === today)
    .reduce((s, o) => s + o.total, 0)
  const weekRevenue = allCompleted
    .filter((o) => (o.completedAt ?? o.createdAt) >= weekAgo)
    .reduce((s, o) => s + o.total, 0)
  const bestDay = daily.length > 0
    ? daily.reduce((best, r) => (r.totalSales > best.totalSales ? r : best), daily[0])
    : null

  return {
    daily,
    topItems,
    cashiers,
    paymentMethods,
    profitability,
    filterOptions: {
      shifts: Array.from(new Map(allCompleted.filter((order) => order.shiftId).map((order) => [
        order.shiftId!,
        { id: order.shiftId!, label: `${new Date(order.createdAt).toLocaleDateString('ar-EG')} - ${order.cashierName}` }
      ])).values()),
      devices: Array.from(new Set((await getCachedDocs<Payment>(COLLECTIONS.payments)).map((payment) => payment.deviceId).filter((value): value is string => Boolean(value))))
    },
    summary: {
      totalOrders: completed.length,
      totalRevenue,
      avgOrderValue: completed.length > 0 ? totalRevenue / completed.length : 0,
      todayOrders,
      todayRevenue,
      weekRevenue,
      bestDay
    }
  }
}

export async function getSalesReport(): Promise<DailySalesReport[]> {
  const data = await getFullReport('all')
  return data.daily
}

export async function getSummaryStats(): Promise<{
  todayOrders: number
  todayRevenue: number
  weekRevenue: number
}> {
  const data = await getFullReport('all')
  return {
    todayOrders: data.summary.todayOrders,
    todayRevenue: data.summary.todayRevenue,
    weekRevenue: data.summary.weekRevenue
  }
}
