/**
 * Order service — SQLite primary database.
 * Supports: discounts, VAT/tax, delivery info, split payment, order editing.
 * All multi-table writes use dbBatch() for atomicity.
 */
import type {
  CashDrawerTransaction,
  DiningTable,
  DiscountType,
  InventoryTransaction,
  MenuItem,
  Order,
  OrderItem,
  OrderType,
  Payment
} from '@shared/types'
import {
  recipeDeductionLines,
  mergeDeductionLines
} from '@shared/services/inventory-ledger'
import {
  orderSubtotal,
  orderTotal,
  lineTotal,
  computeDiscount,
  computeTax,
  computeService
} from '@shared/services/order-calculator'
import { COLLECTIONS } from '@shared/constants/collections'
import { SETTINGS_DOC_ID } from '@shared/constants/collections'
import { RESTAURANT_NAME_AR } from '@shared/constants/branding'
import type { AppSettings } from '@shared/types'
import { cacheDocs, getCachedDoc, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { dbBatch, type DbBatchOp } from '@renderer/lib/db/sqlite-db'
import { generateId } from '@renderer/lib/utils/id'
import { actorAuditName, describePatch, type AuditActor } from '@renderer/features/audit/audit-service'
import { getRecipe } from '../menu/menu-service'
import { ensureOpenShift } from '../shifts/shift-service'
import { nextLocalShiftOrderReference } from '@renderer/lib/offline/order-number'

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettings(): Promise<AppSettings> {
  const defaults: AppSettings = {
    id: SETTINGS_DOC_ID,
    restaurantNameAr: RESTAURANT_NAME_AR,
    currencySymbol: 'ج.م',
    pinEnabled: false,
    autoLockMinutes: 5,
    nextOrderNumber: 1,
    taxRate: 0,
    serviceRate: 0,
    defaultDeliveryFee: 0,
    networkMode: 'standalone',
    masterServerPort: 47831,
    sideDisconnectPolicy: 'block_actions',
    receiptPrintRoute: 'side',
    receiptSectionOrder: ['logo', 'restaurant', 'orderMeta', 'customer', 'items', 'totals', 'payment', 'footer'],
    receiptHiddenSections: [],
    receiptShowItemNotes: true,
    receiptCompactMode: false,
    receiptLogoEnabled: false,
    receiptLogoMode: 'image',
    receiptLogoThreshold: 176,
    receiptLogoWidth: 96,
    receiptLogoInvert: false,
    receiptLogoAlign: 'center',
    receiptLogoMaxWidthPercent: 100,
    autoBackupEnabled: false,
    autoBackupIntervalDays: 1,
    autoBackupOnClose: false,
    backupRetentionDays: 7,
    updatedAt: Date.now()
  }
  const cached = await getCachedDoc<AppSettings>(COLLECTIONS.settings, SETTINGS_DOC_ID)
  return cached ?? defaults
}

export async function updateSettings(
  patch: Partial<
    Pick<
      AppSettings,
      | 'restaurantNameAr'
      | 'currencySymbol'
      | 'receiptFooterAr'
      | 'phoneNumber'
      | 'primaryColor'
      | 'pinEnabled'
      | 'autoLockMinutes'
      | 'taxRate'
      | 'serviceRate'
      | 'defaultDeliveryFee'
      | 'maxCashierDiscountPct'
      | 'keyboardShortcuts'
      | 'networkMode'
      | 'masterServerPort'
      | 'sideDisconnectPolicy'
      | 'receiptPrintRoute'
      | 'receiptSectionOrder'
      | 'receiptHiddenSections'
      | 'receiptShowItemNotes'
      | 'receiptCompactMode'
      | 'receiptLogoEnabled'
      | 'receiptLogoDataUrl'
      | 'receiptLogoProcessedDataUrl'
      | 'receiptLogoAscii'
      | 'receiptLogoMode'
      | 'receiptLogoThreshold'
      | 'receiptLogoWidth'
      | 'receiptLogoInvert'
      | 'receiptLogoAlign'
      | 'receiptLogoMaxWidthPercent'
      | 'backupDirectory'
      | 'backupDirectories'
      | 'autoBackupEnabled'
      | 'autoBackupIntervalDays'
      | 'autoBackupOnClose'
      | 'backupRetentionDays'
      | 'lastAutoBackupAt'
    >
  >,
  actor?: AuditActor
): Promise<void> {
  const current = await getSettings()
  await cacheDocs(COLLECTIONS.settings, [{ ...current, ...patch, updatedAt: Date.now() }])
  if (actor) {
    void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
      logAudit({
        action: 'settings_changed',
        actorId: actor.id,
        actorName: actorAuditName(actor),
        targetId: SETTINGS_DOC_ID,
        targetType: 'settings',
        detailAr: `تغيير إعدادات — ${describePatch(patch)}`
      })
    )
  }
}

// ---------------------------------------------------------------------------
// Cart types
// ---------------------------------------------------------------------------

export interface CartLine {
  menuItemId: string
  nameAr: string
  unitPrice: number
  quantity: number
  sizeLabelAr?: string
  attachmentForMenuItemId?: string
  unitLabel?: string
  weightGrams?: number
  noteAr?: string
}

// ---------------------------------------------------------------------------
// Complete order
// ---------------------------------------------------------------------------

export async function completeOrder(params: {
  cashierId: string
  cashierName: string
  cashierCode?: string
  lines: CartLine[]
  orderNoteAr?: string
  orderType?: OrderType
  table?: Pick<DiningTable, 'id' | 'nameAr' | 'categoryAr'>
  paymentMethod?: 'cash' | 'card' | 'split'
  cashPaid?: number    // for split payment
  cardPaid?: number    // for split payment
  discountType?: DiscountType
  discountValue?: number
  deliveryFee?: number
  customerName?: string
  customerPhone?: string
  customerAddress?: string
}): Promise<Order> {
  const settings = await getSettings()
  const subtotal = orderSubtotal(params.lines)
  const orderType = params.orderType ?? 'takeaway'
  const deliveryFee = params.deliveryFee ?? (orderType === 'delivery' ? (settings.defaultDeliveryFee ?? 0) : 0)

  const discountAmount = computeDiscount(subtotal, params.discountType, params.discountValue)
  const afterDiscount = subtotal - discountAmount
  const taxRate = settings.taxRate ?? 0
  const taxAmount = computeTax(afterDiscount, taxRate)
  const serviceRate = settings.serviceRate ?? 0
  const serviceAmount = computeService(afterDiscount, serviceRate)
  const total = orderTotal(subtotal, discountAmount, taxAmount, deliveryFee, serviceAmount)

  if (orderType === 'takeaway' && !params.paymentMethod) {
    throw new Error('Payment method is required for takeaway orders')
  }
  if (orderType === 'dine_in' && !params.table) {
    throw new Error('Table is required for dine-in orders')
  }

  const shift = await ensureOpenShift({
    cashierId: params.cashierId,
    cashierName: params.cashierName,
    cashierCode: params.cashierCode
  })

  const existingOrders = (await getCachedDocs<Order>(COLLECTIONS.orders)).filter(
    (o) => o.shiftId === shift.id
  )
  const maxShiftSequence = existingOrders.reduce(
    (max, o) => o.orderNumber > 0 && o.orderNumber <= 999999 ? Math.max(max, o.orderNumber) : max,
    0
  )
  const { orderNumber, orderCode } = nextLocalShiftOrderReference(
    shift.id, params.cashierCode, maxShiftSequence
  )

  const now = Date.now()
  const orderId = generateId()
  const isPaid = orderType === 'takeaway'

  const order: Order = {
    id: orderId,
    orderNumber,
    orderCode,
    status: isPaid ? 'completed' : 'draft',
    orderType,
    paymentStatus: isPaid ? (params.paymentMethod === 'split' ? 'split' : 'paid') : 'unpaid',
    tableId: params.table?.id,
    tableNameAr: params.table?.nameAr,
    tableCategoryAr: params.table?.categoryAr,
    shiftId: shift.id,
    cashierId: params.cashierId,
    cashierName: params.cashierName,
    cashierCode: params.cashierCode,
    subtotal,
    discountType: params.discountType,
    discountValue: params.discountValue,
    discountAmount: discountAmount > 0 ? discountAmount : undefined,
    taxRate: taxRate > 0 ? taxRate : undefined,
    taxAmount: taxAmount > 0 ? taxAmount : undefined,
    serviceRate: serviceRate > 0 ? serviceRate : undefined,
    serviceAmount: serviceAmount > 0 ? serviceAmount : undefined,
    deliveryFee: deliveryFee > 0 ? deliveryFee : undefined,
    total,
    noteAr: params.orderNoteAr,
    customerName: params.customerName,
    customerPhone: params.customerPhone,
    customerAddress: params.customerAddress,
    createdAt: now,
    updatedAt: now,
    completedAt: isPaid ? now : undefined,
    paidAt: isPaid ? now : undefined
  }

  const orderItems: OrderItem[] = params.lines.map((line) => ({
    id: generateId(),
    orderId,
    menuItemId: line.menuItemId,
    nameAr: line.nameAr,
    unitPrice: line.unitPrice,
    quantity: line.quantity,
    sizeLabelAr: line.sizeLabelAr,
    attachmentForMenuItemId: line.attachmentForMenuItemId,
    unitLabel: line.unitLabel,
    weightGrams: line.weightGrams,
    lineTotal: lineTotal(line.unitPrice, line.quantity),
    noteAr: line.noteAr
  }))

  // Build payments (supports split)
  const payments: Payment[] = []
  if (isPaid && params.paymentMethod) {
    if (params.paymentMethod === 'split') {
      const cashAmt = Math.round((params.cashPaid ?? 0) * 100) / 100
      const cardAmt = Math.round((params.cardPaid ?? 0) * 100) / 100
      if (cashAmt > 0) payments.push({ id: generateId(), orderId, amount: cashAmt, method: 'cash', createdAt: now })
      if (cardAmt > 0) payments.push({ id: generateId(), orderId, amount: cardAmt, method: 'card', createdAt: now })
    } else {
      payments.push({ id: generateId(), orderId, amount: total, method: params.paymentMethod as 'cash' | 'card', createdAt: now })
    }
  }

  const inventoryTransactions = await buildInventoryTransactions(
    orderId, orderItems, params.cashierId, now, shift.id
  )

  // Cash drawer: one entry per payment method
  const drawerTransactions: CashDrawerTransaction[] = []
  if (isPaid) {
    for (const p of payments) {
      drawerTransactions.push({
        id: generateId(),
        type: 'sale',
        amount: p.amount,
        shiftId: shift.id,
        orderId,
        createdBy: params.cashierId,
        createdAt: now
      })
    }
  }

  // ── Atomic write: all tables in one SQLite transaction ──────────────────
  const batchOps: DbBatchOp[] = [
    { collection: COLLECTIONS.orders, id: order.id, data: order, op: 'set' },
    ...orderItems.map((oi) => ({ collection: COLLECTIONS.orderItems, id: oi.id, data: oi, op: 'set' as const })),
    ...payments.map((p) => ({ collection: COLLECTIONS.payments, id: p.id, data: p, op: 'set' as const })),
    ...inventoryTransactions.map((t) => ({ collection: COLLECTIONS.inventoryTransactions, id: t.id, data: t, op: 'set' as const })),
    ...drawerTransactions.map((d) => ({ collection: COLLECTIONS.cashDrawerTransactions, id: d.id, data: d, op: 'set' as const }))
  ]
  await dbBatch(batchOps)

  // Audit: log discount if one was applied
  if (discountAmount > 0) {
    void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
      logAudit({
        action: 'discount_applied',
        actorId: params.cashierId,
        actorName: params.cashierName,
        targetId: orderId,
        targetType: 'order',
        detailAr: `خصم ${params.discountType === 'percent' ? `${params.discountValue}%` : `${discountAmount.toFixed(2)} ثابت`} على طلب — إجمالي: ${total.toFixed(2)}`
      })
    )
  }

  return order
}

async function buildInventoryTransactions(
  orderId: string,
  items: OrderItem[],
  createdBy: string,
  createdAt: number,
  shiftId?: string
): Promise<InventoryTransaction[]> {
  const transactions: InventoryTransaction[] = []
  for (const item of items) {
    const lines = await buildInventoryLinesForOrderItem(item)
    for (const line of lines) {
      transactions.push({
        id: generateId(),
        ingredientId: line.ingredientId,
        orderItemId: item.id,
        menuItemId: item.menuItemId,
        type: 'sale' as const,
        quantity: line.quantity,
        unit: line.unit,
        referenceType: 'order' as const,
        referenceId: orderId,
        shiftId,
        noteAr: 'خصم تلقائي من الطلب',
        createdBy,
        createdAt
      })
    }
  }
  return transactions
}

function stockQuantityForOrderItem(item: OrderItem, stockUnit: string): number {
  const normalized = stockUnit.trim().toLowerCase()
  if (item.weightGrams != null) {
    if (normalized === 'جرام' || normalized === 'gram' || normalized === 'grams') {
      return item.weightGrams
    }
    if (
      normalized === 'كيلوجرام' ||
      normalized === 'كيلو' ||
      normalized === 'كجم' ||
      normalized === 'kg' ||
      normalized === 'kilogram'
    ) {
      return item.weightGrams / 1000
    }
  }
  return item.quantity
}

async function buildInventoryLinesForOrderItem(
  item: OrderItem
): Promise<Array<{ ingredientId: string; quantity: number; unit: string }>> {
  const menuItem = await getCachedDoc<MenuItem>(COLLECTIONS.menuItems, item.menuItemId)
  if (!menuItem) return []
  if (menuItem.itemType === 'service') return []

  const usesLinkedStock =
    menuItem.itemType === 'raw_material' ||
    menuItem.productType === 'ready_made' ||
    menuItem.productType === 'manufactured'

  if (usesLinkedStock && menuItem.linkedIngredientId) {
    const ingredient = await getCachedDoc<{ unit: string }>(
      COLLECTIONS.ingredients,
      menuItem.linkedIngredientId
    )
    if (!ingredient) return []
    return [{
      ingredientId: menuItem.linkedIngredientId,
      quantity: -Math.abs(stockQuantityForOrderItem(item, ingredient.unit)),
      unit: ingredient.unit
    }]
  }

  if (!menuItem.recipeId) return []
  const recipe = await getRecipe(menuItem.recipeId)
  if (!recipe) return []
  return mergeDeductionLines(recipeDeductionLines(recipe, item.quantity))
}

// ---------------------------------------------------------------------------
// Mark paid (supports split payment)
// ---------------------------------------------------------------------------

export async function markOrderPaid(params: {
  orderId: string
  cashierId: string
  paymentMethod: 'cash' | 'card' | 'split'
  cashPaid?: number
  cardPaid?: number
}): Promise<Order | null> {
  const order = await getCachedDoc<Order>(COLLECTIONS.orders, params.orderId)
  if (!order || order.status === 'cancelled') return null

  const now = Date.now()
  const paidOrder: Order = {
    ...order,
    status: 'completed',
    paymentStatus: params.paymentMethod === 'split' ? 'split' : 'paid',
    paidAt: now,
    completedAt: now,
    updatedAt: now
  }

  const payments: Payment[] = []
  if (params.paymentMethod === 'split') {
    const cashAmt = Math.round((params.cashPaid ?? 0) * 100) / 100
    const cardAmt = Math.round((params.cardPaid ?? 0) * 100) / 100
    if (cashAmt > 0) payments.push({ id: generateId(), orderId: order.id, amount: cashAmt, method: 'cash', createdAt: now })
    if (cardAmt > 0) payments.push({ id: generateId(), orderId: order.id, amount: cardAmt, method: 'card', createdAt: now })
  } else {
    payments.push({ id: generateId(), orderId: order.id, amount: order.total, method: params.paymentMethod, createdAt: now })
  }

  const drawerTransactions: CashDrawerTransaction[] = payments.map((p) => ({
    id: generateId(),
    type: 'sale',
    amount: p.amount,
    shiftId: order.shiftId,
    orderId: order.id,
    createdBy: params.cashierId,
    createdAt: now
  }))

  // ── Atomic write ────────────────────────────────────────────────────────
  await dbBatch([
    { collection: COLLECTIONS.orders, id: paidOrder.id, data: paidOrder, op: 'set' },
    ...payments.map((p) => ({ collection: COLLECTIONS.payments, id: p.id, data: p, op: 'set' as const })),
    ...drawerTransactions.map((d) => ({ collection: COLLECTIONS.cashDrawerTransactions, id: d.id, data: d, op: 'set' as const }))
  ])
  return paidOrder
}

// ---------------------------------------------------------------------------
// Edit open dine-in / delivery order
// ---------------------------------------------------------------------------

export async function editOrderItems(params: {
  orderId: string
  cashierId: string
  lines: CartLine[]
  orderNoteAr?: string
}): Promise<Order> {
  const order = await getCachedDoc<Order>(COLLECTIONS.orders, params.orderId)
  if (!order) throw new Error('الطلب غير موجود')
  if (order.status === 'cancelled') throw new Error('الطلب ملغي')
  if (order.paymentStatus === 'paid' || order.paymentStatus === 'split') {
    throw new Error('لا يمكن تعديل طلب مدفوع')
  }

  const settings = await getSettings()
  const subtotal = orderSubtotal(params.lines)
  const discountAmount = computeDiscount(subtotal, order.discountType, order.discountValue)
  const afterDiscount = subtotal - discountAmount
  const taxRate = settings.taxRate ?? 0
  const taxAmount = computeTax(afterDiscount, taxRate)
  const serviceRate = settings.serviceRate ?? 0
  const serviceAmount = computeService(afterDiscount, serviceRate)
  const deliveryFee = order.deliveryFee ?? 0
  const total = orderTotal(subtotal, discountAmount, taxAmount, deliveryFee, serviceAmount)

  const now = Date.now()
  const updatedOrder: Order = {
    ...order,
    subtotal,
    discountAmount: discountAmount > 0 ? discountAmount : undefined,
    taxAmount: taxAmount > 0 ? taxAmount : undefined,
    serviceRate: serviceRate > 0 ? serviceRate : undefined,
    serviceAmount: serviceAmount > 0 ? serviceAmount : undefined,
    total,
    noteAr: params.orderNoteAr ?? order.noteAr,
    updatedAt: now
  }

  // Replace order items
  const allItems = await getCachedDocs<OrderItem>(COLLECTIONS.orderItems)
  const oldItems = allItems.filter((i) => i.orderId === params.orderId)
  const newItems: OrderItem[] = params.lines.map((line) => ({
    id: generateId(),
    orderId: params.orderId,
    menuItemId: line.menuItemId,
    nameAr: line.nameAr,
    unitPrice: line.unitPrice,
    quantity: line.quantity,
    sizeLabelAr: line.sizeLabelAr,
    attachmentForMenuItemId: line.attachmentForMenuItemId,
    unitLabel: line.unitLabel,
    weightGrams: line.weightGrams,
    lineTotal: lineTotal(line.unitPrice, line.quantity),
    noteAr: line.noteAr
  }))

  // Reverse old inventory deductions, apply new ones
  const oldInventory = (await getCachedDocs<InventoryTransaction>(COLLECTIONS.inventoryTransactions))
    .filter((tx) => tx.referenceId === params.orderId && tx.type === 'sale')
  const reversals: InventoryTransaction[] = oldInventory.map((tx) => ({
    ...tx,
    id: generateId(),
    type: 'sale_reversal' as const,
    quantity: -tx.quantity,
    noteAr: 'عكس تعديل طلب',
    createdAt: now
  }))
  const newInventory = await buildInventoryTransactions(
    params.orderId, newItems, params.cashierId, now, order.shiftId
  )

  // Delete old order items then write new ones — all atomic
  const batchOps: DbBatchOp[] = [
    { collection: COLLECTIONS.orders, id: updatedOrder.id, data: updatedOrder, op: 'set' },
    // delete old items
    ...oldItems.map((oi) => ({ collection: COLLECTIONS.orderItems, id: oi.id, data: { id: oi.id }, op: 'delete' as const })),
    // write new items
    ...newItems.map((oi) => ({ collection: COLLECTIONS.orderItems, id: oi.id, data: oi, op: 'set' as const })),
    // inventory reversals and new deductions
    ...reversals.map((t) => ({ collection: COLLECTIONS.inventoryTransactions, id: t.id, data: t, op: 'set' as const })),
    ...newInventory.map((t) => ({ collection: COLLECTIONS.inventoryTransactions, id: t.id, data: t, op: 'set' as const }))
  ]
  await dbBatch(batchOps)

  return updatedOrder
}

// ---------------------------------------------------------------------------
// Cancel order
// ---------------------------------------------------------------------------

export async function cancelOrder(params: {
  orderId: string
  cancelledBy: string
  reasonAr?: string
  inventoryMode: 'return' | 'waste'
}): Promise<void> {
  const order = await getCachedDoc<Order>(COLLECTIONS.orders, params.orderId)
  if (!order) return

  const now = Date.now()
  const cancelledOrder: Order = {
    ...order,
    status: 'cancelled',
    cancelledAt: now,
    cancelledBy: params.cancelledBy,
    cancelReasonAr: params.reasonAr,
    cancelInventoryMode: params.inventoryMode,
    updatedAt: now
  }

  const shouldReverseCash = order.status === 'completed' &&
    order.paymentStatus !== 'unpaid' && order.paymentStatus !== undefined
  const drawerTransaction: CashDrawerTransaction | null = shouldReverseCash
    ? {
        id: generateId(),
        type: 'sale',
        amount: -order.total,
        shiftId: order.shiftId,
        orderId: order.id,
        noteAr: params.reasonAr || 'إلغاء طلب',
        createdBy: params.cancelledBy,
        createdAt: now
      }
    : null

  // ── Atomic write ────────────────────────────────────────────────────────
  const cancelOps: DbBatchOp[] = [
    { collection: COLLECTIONS.orders, id: cancelledOrder.id, data: cancelledOrder, op: 'set' }
  ]
  if (drawerTransaction) {
    cancelOps.push({ collection: COLLECTIONS.cashDrawerTransactions, id: drawerTransaction.id, data: drawerTransaction, op: 'set' })
  }
  if (params.inventoryMode === 'return') {
    const reversals = await buildInventoryReversals(order.id, params.cancelledBy, now)
    reversals.forEach((r) => cancelOps.push({ collection: COLLECTIONS.inventoryTransactions, id: r.id, data: r, op: 'set' }))
  }
  await dbBatch(cancelOps)

  // Audit
  void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
    logAudit({
      action: 'order_cancelled',
      actorId: params.cancelledBy,
      actorName: params.cancelledBy,
      targetId: order.id,
      targetType: 'order',
      detailAr: `إلغاء طلب #${order.orderCode ?? order.orderNumber} — إجمالي: ${order.total.toFixed(2)}${params.reasonAr ? ` — السبب: ${params.reasonAr}` : ''}`
    })
  )
}

async function buildInventoryReversals(
  orderId: string,
  createdBy: string,
  createdAt: number
): Promise<InventoryTransaction[]> {
  const allTxs = await getCachedDocs<InventoryTransaction>(COLLECTIONS.inventoryTransactions)
  const saleTxs = allTxs.filter((tx) => tx.referenceId === orderId && tx.type === 'sale')
  return saleTxs.map((tx) => ({
    id: generateId(),
    ingredientId: tx.ingredientId,
    type: 'sale_reversal' as const,
    quantity: -tx.quantity,
    unit: tx.unit,
    referenceType: 'order' as const,
    referenceId: orderId,
    shiftId: tx.shiftId,
    noteAr: 'عكس خصم مخزون لطلب ملغي',
    createdBy,
    createdAt
  }))
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listOrders(limit = 50): Promise<Order[]> {
  const orders = await getCachedDocs<Order>(COLLECTIONS.orders)
  return orders.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
}

export async function listUnpaidDineInOrders(): Promise<Order[]> {
  const orders = await listOrders(1000)
  return orders.filter(
    (o) => o.status !== 'cancelled' &&
      (o.orderType ?? 'takeaway') === 'dine_in' &&
      (o.paymentStatus === 'unpaid' || o.status === 'draft')
  )
}

export async function listUnpaidDeferredOrders(): Promise<Order[]> {
  const orders = await listOrders(1000)
  return orders.filter(
    (o) => o.status !== 'cancelled' &&
      ((o.orderType ?? 'takeaway') === 'dine_in' || o.orderType === 'delivery') &&
      (o.paymentStatus === 'unpaid' || o.status === 'draft')
  )
}

export async function getOrderItems(orderId: string): Promise<OrderItem[]> {
  const items = await getCachedDocs<OrderItem>(COLLECTIONS.orderItems)
  return items.filter((item) => item.orderId === orderId)
}

export async function archiveOrders(orderIds: string[]): Promise<void> {
  const orders = await getCachedDocs<Order>(COLLECTIONS.orders)
  const updates = orders
    .filter((o) => orderIds.includes(o.id))
    .map((o) => ({ ...o, archived: true, updatedAt: Date.now() }))
  if (updates.length) await cacheDocs(COLLECTIONS.orders, updates)
}

export async function unarchiveOrders(orderIds: string[]): Promise<void> {
  const orders = await getCachedDocs<Order>(COLLECTIONS.orders)
  const updates = orders
    .filter((o) => orderIds.includes(o.id))
    .map((o) => ({ ...o, archived: false, updatedAt: Date.now() }))
  if (updates.length) await cacheDocs(COLLECTIONS.orders, updates)
}

// ---------------------------------------------------------------------------
// Refund order — REQ-4
// ---------------------------------------------------------------------------

export interface RefundLine {
  orderItemId: string
  menuItemId: string
  nameAr: string
  unitPrice: number
  quantity: number
  lineTotal: number
}

export interface RefundResult {
  refundOrder: Order
  refundAmount: number
}

/**
 * Process a full or partial refund for a completed paid order.
 * Creates a refund order record, a cash_out drawer transaction,
 * and inventory sale_reversal transactions for restocked items.
 */
export async function refundOrder(params: {
  originalOrderId: string
  cashierId: string
  cashierName: string
  lines: RefundLine[]
  reasonAr: string
}): Promise<RefundResult> {
  if (!params.lines.length) throw new Error('اختر صنفًا واحدًا على الأقل للاسترداد')
  if (!params.reasonAr.trim()) throw new Error('سبب الاسترداد مطلوب')

  const original = await getCachedDoc<Order>(COLLECTIONS.orders, params.originalOrderId)
  if (!original) throw new Error('الطلب الأصلي غير موجود')
  if (original.status === 'cancelled') throw new Error('لا يمكن استرداد طلب ملغي')
  if (original.paymentStatus === 'unpaid') throw new Error('لا يمكن استرداد طلب غير مدفوع')

  // Calculate refund amount proportionally (preserving discount/tax ratio)
  const originalSubtotal = original.subtotal > 0 ? original.subtotal : 1
  const refundSubtotal = params.lines.reduce((s, l) => s + l.lineTotal, 0)
  const ratio = refundSubtotal / originalSubtotal

  const refundDiscountAmt = Math.round((original.discountAmount ?? 0) * ratio * 100) / 100
  const refundTaxAmt = Math.round((original.taxAmount ?? 0) * ratio * 100) / 100
  const refundServiceAmt = Math.round((original.serviceAmount ?? 0) * ratio * 100) / 100
  const refundAmount = Math.round((refundSubtotal - refundDiscountAmt + refundTaxAmt + refundServiceAmt) * 100) / 100

  const now = Date.now()
  const refundId = generateId()

  // Mark original order as refunded
  const updatedOriginal: Order = {
    ...original,
    cancelReasonAr: params.reasonAr,
    updatedAt: now
  }

  // Create refund order record (negative total)
  const refundOrder: Order = {
    id: refundId,
    orderNumber: 0,
    orderCode: `RFD-${original.orderCode ?? original.orderNumber}`,
    status: 'cancelled',
    orderType: original.orderType,
    paymentStatus: 'paid',
    shiftId: original.shiftId,
    cashierId: params.cashierId,
    cashierName: params.cashierName,
    cashierCode: original.cashierCode,
    subtotal: -refundSubtotal,
    discountAmount: refundDiscountAmt > 0 ? -refundDiscountAmt : undefined,
    taxAmount: refundTaxAmt > 0 ? -refundTaxAmt : undefined,
    serviceAmount: refundServiceAmt > 0 ? -refundServiceAmt : undefined,
    total: -refundAmount,
    noteAr: `استرداد من طلب #${original.orderCode ?? original.orderNumber}: ${params.reasonAr}`,
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    cancelledAt: now,
    cancelledBy: params.cashierId,
    cancelReasonAr: params.reasonAr
  }

  // Refund order items (negative quantities for receipt display)
  const refundItems: OrderItem[] = params.lines.map((l) => ({
    id: generateId(),
    orderId: refundId,
    menuItemId: l.menuItemId,
    nameAr: l.nameAr,
    unitPrice: l.unitPrice,
    quantity: l.quantity,
    lineTotal: -l.lineTotal
  }))

  // Cash out — money leaves the drawer
  const drawerTx: CashDrawerTransaction = {
    id: generateId(),
    type: 'cash_out',
    amount: -refundAmount,
    shiftId: original.shiftId,
    orderId: refundId,
    noteAr: `استرداد طلب #${original.orderCode ?? original.orderNumber}: ${params.reasonAr}`,
    createdBy: params.cashierId,
    createdAt: now
  }

  // Inventory: restock refunded items via sale_reversal
  const inventoryReversals: InventoryTransaction[] = []
  const allInventoryTxs = await getCachedDocs<InventoryTransaction>(COLLECTIONS.inventoryTransactions)
  for (const line of params.lines) {
    const saleTxs = allInventoryTxs.filter((tx) =>
      tx.referenceId === params.originalOrderId &&
      tx.type === 'sale' &&
      tx.orderItemId === line.orderItemId
    )
    const originalItem = await getCachedDoc<OrderItem>(COLLECTIONS.orderItems, line.orderItemId)
    if (!originalItem || originalItem.quantity <= 0) continue
    const qtyRatio = line.quantity / originalItem.quantity
    for (const tx of saleTxs) {
      inventoryReversals.push({
        id: generateId(),
        ingredientId: tx.ingredientId,
        orderItemId: line.orderItemId,
        menuItemId: line.menuItemId,
        type: 'sale_reversal',
        quantity: Math.abs(tx.quantity) * qtyRatio,
        unit: tx.unit,
        referenceType: 'order',
        referenceId: refundId,
        shiftId: original.shiftId,
        noteAr: `استرداد مخزون: ${params.reasonAr}`,
        createdBy: params.cashierId,
        createdAt: now
      })
    }
  }

  // Atomic write
  await dbBatch([
    { collection: COLLECTIONS.orders, id: updatedOriginal.id, data: updatedOriginal, op: 'set' },
    { collection: COLLECTIONS.orders, id: refundOrder.id, data: refundOrder, op: 'set' },
    ...refundItems.map((ri) => ({ collection: COLLECTIONS.orderItems, id: ri.id, data: ri, op: 'set' as const })),
    { collection: COLLECTIONS.cashDrawerTransactions, id: drawerTx.id, data: drawerTx, op: 'set' },
    ...inventoryReversals.map((r) => ({ collection: COLLECTIONS.inventoryTransactions, id: r.id, data: r, op: 'set' as const }))
  ])

  // Audit
  void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
    logAudit({
      action: 'order_refunded',
      actorId: params.cashierId,
      actorName: params.cashierName,
      targetId: params.originalOrderId,
      targetType: 'order',
      detailAr: `استرداد ${refundAmount.toFixed(2)} من طلب #${original.orderCode ?? original.orderNumber} — ${params.reasonAr}`
    })
  )

  return { refundOrder, refundAmount }
}
