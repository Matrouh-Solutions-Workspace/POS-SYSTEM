/**
 * Order service — SQLite primary database.
 * Supports: discounts, VAT/tax, delivery info, split payment, order editing.
 * All multi-table writes use dbBatch() for atomicity.
 */
import type {
  AppUser,
  CashDrawerTransaction,
  CashRoundingTransaction,
  DiningTable,
  DiscountType,
  InventoryBatch,
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
  computeService,
  effectiveTaxRate
} from '@shared/services/order-calculator'
import { COLLECTIONS } from '@shared/constants/collections'
import { SETTINGS_DOC_ID } from '@shared/constants/collections'
import { RESTAURANT_NAME_AR } from '@shared/constants/branding'
import type { AppSettings } from '@shared/types'
import { cacheDocs, getCachedDoc, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { dbBatch, type DbBatchOp } from '@renderer/lib/db/sqlite-db'
import { generateId } from '@renderer/lib/utils/id'
import { actorAuditName, buildAuditOperations, describePatch, type AuditActor } from '@renderer/features/audit/audit-service'
import { getRecipe } from '../menu/menu-service'
import { ensureOpenShift, getOpenShiftForCashier } from '../shifts/shift-service'
import { nextLocalShiftOrderReference } from '@renderer/lib/offline/order-number'
import { planFifoConsumption, planFifoReversal } from '../inventory/fifo-service'

async function getCurrentDeviceId(): Promise<string> {
  const network = await window.electronAPI.getNetworkStatus().catch(() => null) as {
    mode?: string
    side?: { deviceName?: string }
  } | null
  return network?.side?.deviceName?.trim() || (network?.mode === 'side' ? 'Side POS' : 'Master POS')
}

async function requireManagerAuthorization(userId: string): Promise<AppUser> {
  const user = await getCachedDoc<AppUser>(COLLECTIONS.users, userId)
  if (!user?.active || user.role !== 'manager') {
    throw new Error('هذه العملية تتطلب اعتماد مدير')
  }
  return user
}

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
    taxApplicationMode: 'all',
    taxOrderTypes: ['takeaway', 'dine_in', 'delivery'],
    serviceRate: 0,
    defaultDeliveryFee: 0,
    shiftManagementEnabled: false,
    employeePerformanceTrackingEnabled: false,
    discountsEnabled: true,
    cashRoundingEnabled: false,
    maxCashRoundingDifference: 5,
    cashRoundingIncrement: 1,
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
      | 'taxApplicationMode'
      | 'taxOrderTypes'
      | 'serviceRate'
      | 'defaultDeliveryFee'
      | 'shiftManagementEnabled'
      | 'employeePerformanceTrackingEnabled'
      | 'employeePerformanceTrackingStartedAt'
      | 'discountsEnabled'
      | 'cashRoundingEnabled'
      | 'maxCashRoundingDifference'
      | 'cashRoundingIncrement'
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

async function enforceDiscountPermission(params: {
  cashierId: string
  subtotal: number
  discountType?: DiscountType
  discountValue?: number
  discountAmount: number
  settings: AppSettings
}): Promise<void> {
  if (!params.discountType || !params.discountValue || params.discountAmount <= 0) return
  if (params.settings.discountsEnabled === false) {
    throw new Error('الخصومات غير مفعلة من إعدادات المدير')
  }
  const cashier = await getCachedDoc<AppUser>(COLLECTIONS.users, params.cashierId)
  if (!cashier) throw new Error('تعذر التحقق من صلاحية الخصم للمستخدم الحالي')
  if (cashier.role === 'manager') return
  const maxPct = Number(params.settings.maxCashierDiscountPct)
  if (!Number.isFinite(maxPct) || maxPct >= 100) return
  const effectiveMaxPct = Math.max(0, maxPct)
  const appliedPct = params.discountType === 'percent'
    ? params.discountValue
    : params.subtotal > 0 ? (params.discountAmount / params.subtotal) * 100 : 0
  if (appliedPct > effectiveMaxPct + 0.001) {
    throw new Error(`الخصم يتجاوز الحد المسموح (${effectiveMaxPct}%)`)
  }
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
  cashReceived?: number
  discountType?: DiscountType
  discountValue?: number
  deliveryFee?: number
  contactId?: string
  customerName?: string
  customerPhone?: string
  customerAddress?: string
  roundedTotal?: number
  roundingReason?: string
}): Promise<Order> {
  const settings = await getSettings()
  const subtotal = orderSubtotal(params.lines)
  const orderType = params.orderType ?? 'takeaway'
  const deliveryFee = params.deliveryFee ?? (orderType === 'delivery' ? (settings.defaultDeliveryFee ?? 0) : 0)

  const discountAmount = computeDiscount(subtotal, params.discountType, params.discountValue)
  await enforceDiscountPermission({
    cashierId: params.cashierId,
    subtotal,
    discountType: params.discountType,
    discountValue: params.discountValue,
    discountAmount,
    settings
  })
  const afterDiscount = subtotal - discountAmount
  const taxRate = effectiveTaxRate(
    settings.taxRate,
    orderType,
    settings.taxApplicationMode,
    settings.taxOrderTypes
  )
  const taxAmount = computeTax(afterDiscount, taxRate)
  const serviceRate = settings.serviceRate ?? 0
  const serviceAmount = computeService(afterDiscount, serviceRate)
  const originalTotal = orderTotal(subtotal, discountAmount, taxAmount, deliveryFee, serviceAmount)
  let total = originalTotal
  let roundingDifference = 0

  if (orderType === 'takeaway' && !params.paymentMethod) {
    throw new Error('يرجى اختيار طريقة الدفع لطلبات التيك أواي')
  }
  if (orderType === 'dine_in' && !params.table) {
    throw new Error('يرجى اختيار ترابيزة لطلبات الصالة')
  }

  const shift = await ensureOpenShift({
    cashierId: params.cashierId,
    cashierName: params.cashierName,
    cashierCode: params.cashierCode
  })
  let roundingRecord: CashRoundingTransaction | null = null
  if (params.roundedTotal != null && Math.abs(params.roundedTotal - originalTotal) >= 0.001) {
    if (orderType !== 'takeaway' || params.paymentMethod !== 'cash') {
      throw new Error('تقريب الإجمالي متاح للدفع النقدي الكامل فقط')
    }
    const cashier = await getCachedDoc<AppUser>(COLLECTIONS.users, params.cashierId)
    if (!cashier) throw new Error('تعذر التحقق من صلاحية التقريب')
    const { calculateAutomaticCashRounding, getCashRoundingAccess } = await import('../rounding/cash-rounding-service')
    const access = await getCashRoundingAccess(cashier)
    const automaticRounding = calculateAutomaticCashRounding(originalTotal, access)
    if (!automaticRounding || Math.abs(automaticRounding.finalAmount - params.roundedTotal) >= 0.001) {
      throw new Error('قيمة التقريب يجب أن تكون محسوبة تلقائيًا من النظام')
    }
    roundingDifference = automaticRounding.differenceAmount
    total = automaticRounding.finalAmount
  }

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
  const isPaid = orderType === 'takeaway' || !!params.paymentMethod
  const cashReceived = params.paymentMethod === 'cash'
    ? Math.round((params.cashReceived ?? total) * 100) / 100
    : undefined
  if (isPaid && params.paymentMethod === 'cash' && cashReceived! < total) {
    throw new Error('المبلغ المستلم أقل من إجمالي الطلب')
  }
  const cashChange = cashReceived == null
    ? undefined
    : Math.max(0, Math.round((cashReceived - total) * 100) / 100)

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
    originalTotal: Math.abs(roundingDifference) > 0.001 ? originalTotal : undefined,
    roundingDifference: Math.abs(roundingDifference) > 0.001 ? roundingDifference : undefined,
    roundingReason: Math.abs(roundingDifference) > 0.001 ? params.roundingReason?.trim() : undefined,
    cashPaidAmount: cashReceived,
    cashChangeAmount: cashChange,
    noteAr: params.orderNoteAr,
    contactId: orderType === 'delivery' ? params.contactId : undefined,
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
  if (Math.abs(roundingDifference) > 0.001) {
    roundingRecord = {
      id: generateId(),
      orderId,
      shiftId: shift.id,
      userId: params.cashierId,
      username: params.cashierName,
      deviceId: await getCurrentDeviceId(),
      originalAmount: originalTotal,
      finalAmount: total,
      differenceAmount: roundingDifference,
      reason: params.roundingReason?.trim() || 'تقريب نقدي تلقائي',
      createdAt: now
    }
  }

  // Build payments (supports split)
  const paymentDeviceId = await getCurrentDeviceId()
  const payments: Payment[] = []
  if (isPaid && params.paymentMethod) {
    if (params.paymentMethod === 'split') {
      const cashAmt = Math.round((params.cashPaid ?? 0) * 100) / 100
      const cardAmt = Math.round((params.cardPaid ?? 0) * 100) / 100
      if (Math.abs(cashAmt + cardAmt - total) >= 0.001) throw new Error('مجموع الدفع النقدي والبطاقة لا يساوي إجمالي الطلب')
      if (cashAmt > 0) payments.push({ id: generateId(), orderId, amount: cashAmt, paidAmount: cashAmt, changeAmount: 0, employeeId: params.cashierId, shiftId: shift.id, deviceId: paymentDeviceId, method: 'cash', createdAt: now })
      if (cardAmt > 0) payments.push({ id: generateId(), orderId, amount: cardAmt, paidAmount: cardAmt, changeAmount: 0, employeeId: params.cashierId, shiftId: shift.id, deviceId: paymentDeviceId, method: 'card', createdAt: now })
    } else {
      payments.push({
        id: generateId(),
        orderId,
        amount: total,
        paidAmount: params.paymentMethod === 'cash' ? cashReceived : total,
        changeAmount: params.paymentMethod === 'cash' ? cashChange : 0,
        employeeId: params.cashierId,
        shiftId: shift.id,
        deviceId: paymentDeviceId,
        method: params.paymentMethod as 'cash' | 'card',
        createdAt: now
      })
    }
  }

  const inventoryPlan = await buildFifoInventoryTransactions(
    orderId, orderItems, params.cashierId, now, shift.id
  )

  // Cash drawer: one entry per payment method
  const drawerTransactions: CashDrawerTransaction[] = []
  if (isPaid) {
    for (const p of payments.filter((payment) => payment.method === 'cash')) {
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
    ...inventoryPlan.transactions.map((t) => ({ collection: COLLECTIONS.inventoryTransactions, id: t.id, data: t, op: 'set' as const })),
    ...inventoryPlan.batches.map((batch) => ({ collection: COLLECTIONS.inventoryBatches, id: batch.id, data: batch, op: 'set' as const })),
    ...drawerTransactions.map((d) => ({ collection: COLLECTIONS.cashDrawerTransactions, id: d.id, data: d, op: 'set' as const })),
    ...(roundingRecord ? [{
      collection: COLLECTIONS.cashRoundingTransactions,
      id: roundingRecord.id,
      data: roundingRecord,
      op: 'set' as const
    }] : [])
  ]
  await dbBatch(batchOps)

  if (orderType === 'delivery' && params.contactId) {
    void import('@renderer/features/contacts/delivery-contact-service').then(({ markContactUsed }) =>
      markContactUsed(params.contactId, orderId, now)
    )
  }

  void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
    logAudit({
      action: 'order_created',
      actorId: params.cashierId,
      actorName: params.cashierName,
      targetId: orderId,
      targetType: 'order',
      detailAr: `إنشاء طلب #${order.orderCode ?? order.orderNumber} — الإجمالي: ${total.toFixed(2)}`
    })
  )

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
    const actor = await getCachedDoc<AppUser>(COLLECTIONS.users, params.cashierId)
    const maxPct = settings.maxCashierDiscountPct
    const appliedPct = params.discountType === 'percent'
      ? (params.discountValue ?? 0)
      : subtotal > 0 ? (discountAmount / subtotal) * 100 : 0
    if ((actor?.role === 'manager' || actor?.role === 'supervisor') && maxPct != null && maxPct < 100 && appliedPct > maxPct + 0.001) {
      void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
        logAudit({
          action: 'manager_override_discount',
          actorId: params.cashierId,
          actorName: actor.username,
          targetId: orderId,
          targetType: 'order',
          detailAr: `تجاوز خصم المدير على طلب #${order.orderCode ?? order.orderNumber}: الخصم ${appliedPct.toFixed(2)}% والحد ${maxPct}%`
        })
      )
    }
  }
  if (roundingRecord) {
    void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
      logAudit({
        action: 'cash_rounding_applied',
        actorId: params.cashierId,
        actorName: params.cashierName,
        targetId: orderId,
        targetType: 'order',
        detailAr: `تقريب نقدي لطلب #${order.orderCode ?? order.orderNumber}: الإجمالي الأصلي ${originalTotal.toFixed(2)} — التقريب ${roundingRecord.differenceAmount.toFixed(2)} — الإجمالي النهائي ${total.toFixed(2)}`
      })
    )
  }

  return order
}

async function buildFifoInventoryTransactions(
  orderId: string,
  items: OrderItem[],
  createdBy: string,
  createdAt: number,
  shiftId?: string
): Promise<{ transactions: InventoryTransaction[]; batches: InventoryBatch[] }> {
  const deductions: Array<{
    ingredientId: string
    quantity: number
    unit: string
    orderItemId: string
    menuItemId: string
  }> = []
  for (const item of items) {
    const lines = await buildInventoryLinesForOrderItem(item)
    for (const line of lines) {
      deductions.push({
        ingredientId: line.ingredientId,
        orderItemId: item.id,
        menuItemId: item.menuItemId,
        quantity: line.quantity,
        unit: line.unit
      })
    }
  }
  return planFifoConsumption({
    lines: deductions,
    referenceId: orderId,
    createdBy,
    createdAt,
    shiftId,
    noteAr: 'خصم تلقائي من الطلب'
  })
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
  cashReceived?: number
  roundedTotal?: number
  roundingReason?: string
}): Promise<Order | null> {
  const order = await getCachedDoc<Order>(COLLECTIONS.orders, params.orderId)
  if (!order || order.status === 'cancelled') return null
  if (order.status === 'completed' || order.paymentStatus === 'paid' || order.paymentStatus === 'split') return order

  const now = Date.now()
  const originalTotal = order.total
  let finalTotal = originalTotal
  let roundingRecord: CashRoundingTransaction | null = null
  if (params.roundedTotal != null && Math.abs(params.roundedTotal - originalTotal) >= 0.001) {
    if (params.paymentMethod !== 'cash') throw new Error('تقريب الإجمالي متاح للدفع النقدي الكامل فقط')
    const cashier = await getCachedDoc<AppUser>(COLLECTIONS.users, params.cashierId)
    if (!cashier) throw new Error('تعذر التحقق من صلاحية التقريب')
    const { calculateAutomaticCashRounding, getCashRoundingAccess } = await import('../rounding/cash-rounding-service')
    const access = await getCashRoundingAccess(cashier)
    const automaticRounding = calculateAutomaticCashRounding(originalTotal, access)
    if (!automaticRounding || Math.abs(automaticRounding.finalAmount - params.roundedTotal) >= 0.001) {
      throw new Error('قيمة التقريب يجب أن تكون محسوبة تلقائيًا من النظام')
    }
    finalTotal = automaticRounding.finalAmount
    const shiftId = order.shiftId ?? (await getOpenShiftForCashier(params.cashierId))?.id
    if (!shiftId) throw new Error('لا يوجد شيفت مفتوح لتسجيل التقريب')
    roundingRecord = {
      id: generateId(),
      orderId: order.id,
      shiftId,
      userId: params.cashierId,
      username: cashier.username,
      deviceId: await getCurrentDeviceId(),
      originalAmount: originalTotal,
      finalAmount: finalTotal,
      differenceAmount: automaticRounding.differenceAmount,
      reason: params.roundingReason?.trim() || 'تقريب نقدي تلقائي',
      createdAt: now
    }
  }
  const paidOrder: Order = {
    ...order,
    status: 'completed',
    paymentStatus: params.paymentMethod === 'split' ? 'split' : 'paid',
    total: finalTotal,
    originalTotal: roundingRecord ? originalTotal : order.originalTotal,
    roundingDifference: roundingRecord ? roundingRecord.differenceAmount : order.roundingDifference,
    roundingReason: roundingRecord ? roundingRecord.reason : order.roundingReason,
    cashPaidAmount: params.paymentMethod === 'cash'
      ? Math.round((params.cashReceived ?? finalTotal) * 100) / 100
      : order.cashPaidAmount,
    cashChangeAmount: params.paymentMethod === 'cash'
      ? Math.max(0, Math.round(((params.cashReceived ?? finalTotal) - finalTotal) * 100) / 100)
      : order.cashChangeAmount,
    paidAt: now,
    completedAt: now,
    updatedAt: now
  }

  const paidDeviceId = await getCurrentDeviceId()
  const payments: Payment[] = []
  if (params.paymentMethod === 'cash' && (params.cashReceived ?? finalTotal) < finalTotal) {
    throw new Error('المبلغ المستلم أقل من إجمالي الطلب')
  }
  if (params.paymentMethod === 'split') {
    const cashAmt = Math.round((params.cashPaid ?? 0) * 100) / 100
    const cardAmt = Math.round((params.cardPaid ?? 0) * 100) / 100
    if (Math.abs(cashAmt + cardAmt - finalTotal) >= 0.001) throw new Error('مجموع الدفع النقدي والبطاقة لا يساوي إجمالي الطلب')
    if (cashAmt > 0) payments.push({ id: generateId(), orderId: order.id, amount: cashAmt, paidAmount: cashAmt, changeAmount: 0, employeeId: params.cashierId, shiftId: order.shiftId, deviceId: paidDeviceId, method: 'cash', createdAt: now })
    if (cardAmt > 0) payments.push({ id: generateId(), orderId: order.id, amount: cardAmt, paidAmount: cardAmt, changeAmount: 0, employeeId: params.cashierId, shiftId: order.shiftId, deviceId: paidDeviceId, method: 'card', createdAt: now })
  } else {
    payments.push({
      id: generateId(),
      orderId: order.id,
      amount: finalTotal,
      paidAmount: params.paymentMethod === 'cash' ? paidOrder.cashPaidAmount : finalTotal,
      changeAmount: params.paymentMethod === 'cash' ? paidOrder.cashChangeAmount : 0,
      employeeId: params.cashierId,
      shiftId: order.shiftId,
      deviceId: paidDeviceId,
      method: params.paymentMethod,
      createdAt: now
    })
  }

  const drawerTransactions: CashDrawerTransaction[] = payments
    .filter((payment) => payment.method === 'cash')
    .map((p) => ({
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
    ...drawerTransactions.map((d) => ({ collection: COLLECTIONS.cashDrawerTransactions, id: d.id, data: d, op: 'set' as const })),
    ...(roundingRecord ? [{
      collection: COLLECTIONS.cashRoundingTransactions,
      id: roundingRecord.id,
      data: roundingRecord,
      op: 'set' as const
    }] : [])
  ])
  void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
    logAudit({
      action: 'order_paid',
      actorId: params.cashierId,
      actorName: order.cashierName,
      targetId: order.id,
      targetType: 'order',
      detailAr: `تحصيل طلب #${order.orderCode ?? order.orderNumber} — ${paidOrder.total.toFixed(2)}`
    })
  )
  if (roundingRecord) {
    void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
      logAudit({
        action: 'cash_rounding_applied',
        actorId: params.cashierId,
        actorName: roundingRecord.username,
        targetId: order.id,
        targetType: 'order',
        detailAr: `تقريب نقدي لطلب #${order.orderCode ?? order.orderNumber}: الإجمالي الأصلي ${originalTotal.toFixed(2)} — التقريب ${roundingRecord.differenceAmount.toFixed(2)} — الإجمالي النهائي ${finalTotal.toFixed(2)}`
      })
    )
  }
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
  const taxRate = effectiveTaxRate(
    settings.taxRate,
    order.orderType ?? 'takeaway',
    settings.taxApplicationMode,
    settings.taxOrderTypes
  )
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
  const editBatches = await getCachedDocs<InventoryBatch>(COLLECTIONS.inventoryBatches)
  const editReversalPlan = await planFifoReversal(oldInventory, {
    referenceId: params.orderId,
    createdBy: params.cashierId,
    createdAt: now,
    noteAr: 'عكس مخزون قبل تعديل الطلب',
    batches: editBatches
  })
  const editReversedById = new Map(editReversalPlan.batches.map((batch) => [batch.id, batch]))
  const editBatchesAfterReversal = editBatches.map((batch) => editReversedById.get(batch.id) ?? batch)
  const editDeductions = (await Promise.all(newItems.map(async (item) =>
    (await buildInventoryLinesForOrderItem(item)).map((line) => ({
      ...line,
      orderItemId: item.id,
      menuItemId: item.menuItemId
    }))
  ))).flat()
  const editNewPlan = await planFifoConsumption({
    lines: editDeductions,
    referenceId: params.orderId,
    createdBy: params.cashierId,
    createdAt: now,
    shiftId: order.shiftId,
    noteAr: 'خصم مخزون بعد تعديل الطلب',
    batches: editBatchesAfterReversal
  })
  const editBatchUpdates = new Map(editReversalPlan.batches.map((batch) => [batch.id, batch]))
  editNewPlan.batches.forEach((batch) => editBatchUpdates.set(batch.id, batch))

  // Delete old order items then write new ones — all atomic
  const batchOps: DbBatchOp[] = [
    { collection: COLLECTIONS.orders, id: updatedOrder.id, data: updatedOrder, op: 'set' },
    // delete old items
    ...oldItems.map((oi) => ({ collection: COLLECTIONS.orderItems, id: oi.id, data: { id: oi.id }, op: 'delete' as const })),
    // write new items
    ...newItems.map((oi) => ({ collection: COLLECTIONS.orderItems, id: oi.id, data: oi, op: 'set' as const })),
    // inventory reversals and new deductions
    ...editReversalPlan.transactions.map((t) => ({ collection: COLLECTIONS.inventoryTransactions, id: t.id, data: t, op: 'set' as const })),
    ...editNewPlan.transactions.map((t) => ({ collection: COLLECTIONS.inventoryTransactions, id: t.id, data: t, op: 'set' as const })),
    ...Array.from(editBatchUpdates.values()).map((batch) => ({ collection: COLLECTIONS.inventoryBatches, id: batch.id, data: batch, op: 'set' as const }))
  ]
  await dbBatch(batchOps)

  void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
    logAudit({
      action: 'order_updated',
      actorId: params.cashierId,
      actorName: order.cashierName,
      targetId: order.id,
      targetType: 'order',
      detailAr: `تعديل طلب #${order.orderCode ?? order.orderNumber} — الإجمالي الجديد: ${total.toFixed(2)}`
    })
  )

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
  const actor = await requireManagerAuthorization(params.cancelledBy)
  const order = await getCachedDoc<Order>(COLLECTIONS.orders, params.orderId)
  if (!order) return
  if (order.status === 'cancelled') return

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
  const orderPayments = shouldReverseCash
    ? (await getCachedDocs<Payment>(COLLECTIONS.payments)).filter((payment) =>
        payment.orderId === order.id && payment.amount > 0
      )
    : []
  const paymentReversals: Payment[] = orderPayments.map((payment) => ({
    id: generateId(),
    orderId: order.id,
    amount: -payment.amount,
    method: payment.method,
    createdAt: now
  }))
  const cashToReverse = orderPayments
    .filter((payment) => payment.method === 'cash')
    .reduce((sum, payment) => sum + payment.amount, 0)
  const drawerTransaction: CashDrawerTransaction | null = shouldReverseCash && cashToReverse > 0
    ? {
        id: generateId(),
        type: 'sale',
        amount: -cashToReverse,
        shiftId: order.shiftId,
        orderId: order.id,
        noteAr: params.reasonAr || 'إلغاء طلب',
        createdBy: params.cancelledBy,
        createdAt: now
      }
    : null
  const roundingReversal: CashRoundingTransaction | null =
    shouldReverseCash && order.shiftId && Math.abs(order.roundingDifference ?? 0) > 0.001
      ? {
          id: generateId(),
          orderId: order.id,
          shiftId: order.shiftId,
          userId: params.cancelledBy,
          username: params.cancelledBy,
          deviceId: await getCurrentDeviceId(),
          originalAmount: order.total,
          finalAmount: order.originalTotal ?? order.total + (order.roundingDifference ?? 0),
          differenceAmount: -Math.round((order.roundingDifference ?? 0) * 100) / 100,
          reason: `عكس تقريب نقدي بسبب إلغاء الطلب${params.reasonAr ? ` — ${params.reasonAr}` : ''}`,
          createdAt: now
        }
      : null

  // ── Atomic write ────────────────────────────────────────────────────────
  const cancelOps: DbBatchOp[] = [
    { collection: COLLECTIONS.orders, id: cancelledOrder.id, data: cancelledOrder, op: 'set' }
  ]
  if (drawerTransaction) {
    if (drawerTransaction.amount !== 0) {
      cancelOps.push({ collection: COLLECTIONS.cashDrawerTransactions, id: drawerTransaction.id, data: drawerTransaction, op: 'set' })
    }
  }
  paymentReversals.forEach((payment) =>
    cancelOps.push({ collection: COLLECTIONS.payments, id: payment.id, data: payment, op: 'set' })
  )
  if (roundingReversal) {
    cancelOps.push({
      collection: COLLECTIONS.cashRoundingTransactions,
      id: roundingReversal.id,
      data: roundingReversal,
      op: 'set'
    })
  }
  if (params.inventoryMode === 'return') {
    const reversalPlan = await buildFifoInventoryReversals(order.id, params.cancelledBy, now)
    reversalPlan.transactions.forEach((r) => cancelOps.push({ collection: COLLECTIONS.inventoryTransactions, id: r.id, data: r, op: 'set' }))
    reversalPlan.batches.forEach((batch) => cancelOps.push({ collection: COLLECTIONS.inventoryBatches, id: batch.id, data: batch, op: 'set' }))
  }
  cancelOps.push(...await buildAuditOperations({
    action: 'order_cancelled',
    actorId: params.cancelledBy,
    actorName: actorAuditName(actor),
    targetId: order.id,
    targetType: 'order',
    detailAr: `إلغاء طلب #${order.orderCode ?? order.orderNumber} - إجمالي: ${order.total.toFixed(2)}${params.reasonAr ? ` - السبب: ${params.reasonAr}` : ''}`
  }))
  if (roundingReversal) {
    cancelOps.push(...await buildAuditOperations({
      action: 'cash_rounding_applied',
      actorId: params.cancelledBy,
      actorName: actorAuditName(actor),
      targetId: order.id,
      targetType: 'order',
      detailAr: `عكس تقريب نقدي بقيمة ${Math.abs(roundingReversal.differenceAmount).toFixed(2)} بسبب إلغاء طلب #${order.orderCode ?? order.orderNumber}`
    }))
  }
  await dbBatch(cancelOps)

}

async function buildFifoInventoryReversals(
  orderId: string,
  createdBy: string,
  createdAt: number
): Promise<{ transactions: InventoryTransaction[]; batches: InventoryBatch[] }> {
  const allTxs = await getCachedDocs<InventoryTransaction>(COLLECTIONS.inventoryTransactions)
  return planFifoReversal(
    allTxs.filter((tx) => tx.referenceId === orderId && tx.type === 'sale'),
    {
      referenceId: orderId,
      createdBy,
      createdAt,
      noteAr: 'عكس خصم مخزون لطلب ملغي'
    }
  )
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
  const actor = await requireManagerAuthorization(params.cashierId)
  if (!params.lines.length) throw new Error('اختر صنفًا واحدًا على الأقل للاسترداد')
  if (!params.reasonAr.trim()) throw new Error('سبب الاسترداد مطلوب')

  const original = await getCachedDoc<Order>(COLLECTIONS.orders, params.originalOrderId)
  if (!original) throw new Error('الطلب الأصلي غير موجود')
  if (original.status === 'cancelled') throw new Error('لا يمكن استرداد طلب ملغي')
  if (original.paymentStatus === 'unpaid') throw new Error('لا يمكن استرداد طلب غير مدفوع')

  const allOrders = await getCachedDocs<Order>(COLLECTIONS.orders)
  const priorRefundOrders = allOrders.filter((o) => o.refundOfOrderId === original.id)
  const priorRefundOrderIds = new Set(priorRefundOrders.map((o) => o.id))
  const allItems = await getCachedDocs<OrderItem>(COLLECTIONS.orderItems)
  const priorRefundItems = allItems.filter((i) => priorRefundOrderIds.has(i.orderId))
  const refundedQtyByItem = new Map<string, number>()
  for (const item of priorRefundItems) {
    refundedQtyByItem.set(item.menuItemId, (refundedQtyByItem.get(item.menuItemId) ?? 0) + Math.abs(item.quantity))
  }
  const originalItems = allItems.filter((i) => i.orderId === original.id)
  const originalQtyByItem = new Map<string, number>()
  for (const item of originalItems) {
    originalQtyByItem.set(item.menuItemId, (originalQtyByItem.get(item.menuItemId) ?? 0) + item.quantity)
  }
  for (const line of params.lines) {
    const originalQty = originalQtyByItem.get(line.menuItemId) ?? 0
    const alreadyRefunded = refundedQtyByItem.get(line.menuItemId) ?? 0
    if (line.quantity > originalQty - alreadyRefunded) {
      throw new Error(`الكمية المستردة للصنف (${line.nameAr}) تتجاوز الكمية المتاحة للاسترداد`)
    }
  }

  // Calculate refund amount proportionally (preserving discount/tax ratio)
  const originalSubtotal = original.subtotal > 0 ? original.subtotal : 1
  const refundSubtotal = params.lines.reduce((s, l) => s + l.lineTotal, 0)
  const ratio = refundSubtotal / originalSubtotal

  const refundDiscountAmt = Math.round((original.discountAmount ?? 0) * ratio * 100) / 100
  const refundTaxAmt = Math.round((original.taxAmount ?? 0) * ratio * 100) / 100
  const refundServiceAmt = Math.round((original.serviceAmount ?? 0) * ratio * 100) / 100
  const refundBeforeRounding = Math.round((refundSubtotal - refundDiscountAmt + refundTaxAmt + refundServiceAmt) * 100) / 100
  const refundRoundingShare = Math.round((original.roundingDifference ?? 0) * ratio * 100) / 100
  const refundAmount = Math.max(0, Math.round((refundBeforeRounding - refundRoundingShare) * 100) / 100)

  const now = Date.now()
  const refundId = generateId()
  const originalPayments = (await getCachedDocs<Payment>(COLLECTIONS.payments))
    .filter((payment) => payment.orderId === original.id && payment.amount > 0)
  const paidTotal = originalPayments.reduce((sum, payment) => sum + payment.amount, 0)
  const cashPaid = originalPayments
    .filter((payment) => payment.method === 'cash')
    .reduce((sum, payment) => sum + payment.amount, 0)
  const cashRefundAmount = paidTotal > 0
    ? Math.round(refundAmount * (cashPaid / paidTotal) * 100) / 100
    : refundAmount
  const cardRefundAmount = Math.max(0, Math.round((refundAmount - cashRefundAmount) * 100) / 100)

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
    cancelReasonAr: params.reasonAr,
    refundOfOrderId: original.id
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
  const drawerTx: CashDrawerTransaction | null = cashRefundAmount > 0 ? {
    id: generateId(),
    type: 'cash_out',
    amount: -cashRefundAmount,
    shiftId: original.shiftId,
    orderId: refundId,
    noteAr: `استرداد طلب #${original.orderCode ?? original.orderNumber}: ${params.reasonAr}`,
    createdBy: params.cashierId,
    createdAt: now
  } : null
  const refundPayments: Payment[] = [
    ...(cashRefundAmount > 0 ? [{
      id: generateId(),
      orderId: refundId,
      amount: -cashRefundAmount,
      method: 'cash' as const,
      createdAt: now
    }] : []),
    ...(cardRefundAmount > 0 ? [{
      id: generateId(),
      orderId: refundId,
      amount: -cardRefundAmount,
      method: 'card' as const,
      createdAt: now
    }] : [])
  ]
  const roundingReversal: CashRoundingTransaction | null =
    original.shiftId && Math.abs(refundRoundingShare) > 0.001
      ? {
          id: generateId(),
          orderId: refundId,
          shiftId: original.shiftId,
          userId: params.cashierId,
          username: params.cashierName,
          deviceId: await getCurrentDeviceId(),
          originalAmount: refundBeforeRounding,
          finalAmount: refundAmount,
          differenceAmount: -refundRoundingShare,
          reason: `عكس تقريب نقدي بسبب استرداد طلب — ${params.reasonAr}`,
          createdAt: now
        }
      : null

  // Inventory: restock refunded items via sale_reversal
  const inventoryReversals: InventoryTransaction[] = []
  const allInventoryTxs = await getCachedDocs<InventoryTransaction>(COLLECTIONS.inventoryTransactions)
  const refundBatches = await getCachedDocs<InventoryBatch>(COLLECTIONS.inventoryBatches)
  const refundBatchById = new Map(refundBatches.map((batch) => [batch.id, { ...batch }]))
  const changedRefundBatches = new Map<string, InventoryBatch>()
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
      const restoredQuantity = Math.abs(tx.quantity) * qtyRatio
      const batch = tx.batchId ? refundBatchById.get(tx.batchId) : undefined
      if (batch) {
        batch.remainingQuantity = Math.min(batch.quantity, batch.remainingQuantity + restoredQuantity)
        changedRefundBatches.set(batch.id, batch)
      }
      inventoryReversals.push({
        id: generateId(),
        ingredientId: tx.ingredientId,
        orderItemId: line.orderItemId,
        menuItemId: line.menuItemId,
        type: 'sale_reversal',
        quantity: restoredQuantity,
        unit: tx.unit,
        referenceType: 'order',
        referenceId: refundId,
        shiftId: original.shiftId,
        batchId: tx.batchId,
        unitCost: tx.unitCost,
        totalCost: (tx.totalCost ?? Math.abs(tx.quantity) * (tx.unitCost ?? 0)) * qtyRatio,
        noteAr: `استرداد مخزون: ${params.reasonAr}`,
        createdBy: params.cashierId,
        createdAt: now
      })
    }
  }

  // Atomic write
  const refundOps: DbBatchOp[] = [
    { collection: COLLECTIONS.orders, id: updatedOriginal.id, data: updatedOriginal, op: 'set' },
    { collection: COLLECTIONS.orders, id: refundOrder.id, data: refundOrder, op: 'set' },
    ...refundItems.map((ri) => ({ collection: COLLECTIONS.orderItems, id: ri.id, data: ri, op: 'set' as const })),
    ...refundPayments.map((payment) => ({ collection: COLLECTIONS.payments, id: payment.id, data: payment, op: 'set' as const })),
    ...(roundingReversal ? [{
      collection: COLLECTIONS.cashRoundingTransactions,
      id: roundingReversal.id,
      data: roundingReversal,
      op: 'set' as const
    }] : []),
    ...(drawerTx ? [{ collection: COLLECTIONS.cashDrawerTransactions, id: drawerTx.id, data: drawerTx, op: 'set' as const }] : []),
    ...inventoryReversals.map((r) => ({ collection: COLLECTIONS.inventoryTransactions, id: r.id, data: r, op: 'set' as const })),
    ...Array.from(changedRefundBatches.values()).map((batch) => ({ collection: COLLECTIONS.inventoryBatches, id: batch.id, data: batch, op: 'set' as const }))
  ]
  refundOps.push(...await buildAuditOperations({
    action: 'order_refunded',
    actorId: params.cashierId,
    actorName: actorAuditName(actor),
    targetId: params.originalOrderId,
    targetType: 'order',
    detailAr: `استرداد ${refundAmount.toFixed(2)} من طلب #${original.orderCode ?? original.orderNumber} - ${params.reasonAr}`
  }))
  if (roundingReversal) {
    refundOps.push(...await buildAuditOperations({
      action: 'cash_rounding_applied',
      actorId: params.cashierId,
      actorName: actorAuditName(actor),
      targetId: params.originalOrderId,
      targetType: 'order',
      detailAr: `عكس تقريب نقدي بقيمة ${Math.abs(roundingReversal.differenceAmount).toFixed(2)} بسبب استرداد طلب #${original.orderCode ?? original.orderNumber}`
    }))
  }
  await dbBatch(refundOps)

  return { refundOrder, refundAmount }
}
