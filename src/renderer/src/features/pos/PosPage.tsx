import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DiningTable,
  DiscountType,
  MenuCategory,
  MenuItem,
  MenuItemAttachment,
  MenuItemSizeOption,
  Order,
  OrderType
} from '@shared/types'
import { getIngredientStocks } from '@renderer/features/inventory/inventory-service'
import { listCategories, listMenuItems, getRecipeByMenuItem } from '@renderer/features/menu/menu-service'
import {
  completeOrder,
  editOrderItems,
  getSettings,
  listUnpaidDineInOrders,
  type CartLine
} from '@renderer/features/orders/order-service'
import { getOrderItems } from '@renderer/features/orders/order-service'
import { listDiningTables } from '@renderer/features/tables/table-service'
import { printReceipt } from '@renderer/features/receipt/receipt-builder'
import { printKitchenTickets } from '@renderer/features/printers/kitchen-printing'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import {
  lineTotal,
  orderSubtotal,
  orderTotal,
  computeDiscount,
  computeTax
} from '@shared/services/order-calculator'
import { orderReference } from '@shared/services/order-reference'
import {
  closeShift,
  ensureOpenShift,
  getOpenShiftForCashier
} from '@renderer/features/shifts/shift-service'
import { FloorMapPicker } from './FloorMapPicker'

// ── Local cart line type ──────────────────────────────────────────────────

interface LocalCartLine extends CartLine {
  key: string
  parentKey?: string
}

interface PendingCartSelection {
  item: MenuItem
  quantity: number
  unitPrice: number
  size?: MenuItemSizeOption
  anchor: DOMRect
}

// ── Floating popup wrapper ────────────────────────────────────────────────

function FloatingPopup({
  anchor,
  onClose,
  children
}: {
  anchor: DOMRect
  onClose: () => void
  children: React.ReactNode
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="weight-popup"
      style={{
        position: 'fixed',
        zIndex: 500,
        left: anchor.left,
        top: anchor.bottom + 6,
        minWidth: Math.max(anchor.width || 160, 220)
      }}
    >
      {children}
    </div>
  )
}

// ── Weight popup ──────────────────────────────────────────────────────────

function WeightPopup({
  item,
  anchor,
  onSelect,
  onClose
}: {
  item: MenuItem
  anchor: DOMRect
  onSelect: (kg: number, unitPrice: number) => void
  onClose: () => void
}): React.ReactElement {
  const [customGrams, setCustomGrams] = useState('')
  const options = item.weightedPriceOptions ?? []
  const customUnitPrice = item.customWeightUnitPrice ?? item.price

  return (
    <FloatingPopup anchor={anchor} onClose={onClose}>
      <div className="weight-popup__header">
        <span>{item.nameAr}</span>
        <span className="weight-popup__price">
          {item.allowCustomWeight ? `${customUnitPrice.toFixed(2)} / كجم مخصص` : 'أسعار محددة'}
        </span>
      </div>
      {options.length > 0 ? (
        <div className="weight-popup__shortcuts">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="weight-popup__btn"
              onClick={() => { onSelect(option.weightKg, option.price / option.weightKg); onClose() }}
            >
              <span>{option.label}</span>
              <span>{option.price.toFixed(2)}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="weight-popup__empty">لا توجد أسعار محددة لهذا الصنف</p>
      )}
      {item.allowCustomWeight && (
        <div className="weight-popup__custom">
          <input
            type="number"
            min="1"
            step="1"
            value={customGrams}
            onChange={(e) => setCustomGrams(e.target.value)}
            placeholder="جرام"
          />
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => {
              const grams = Number(customGrams)
              if (grams <= 0) return
              onSelect(grams / 1000, customUnitPrice)
              onClose()
            }}
          >
            إضافة
          </button>
        </div>
      )}
    </FloatingPopup>
  )
}

// ── Size popup ────────────────────────────────────────────────────────────

function SizePopup({
  item,
  anchor,
  onSelect,
  onClose
}: {
  item: MenuItem
  anchor: DOMRect
  onSelect: (size: MenuItemSizeOption) => void
  onClose: () => void
}): React.ReactElement {
  return (
    <FloatingPopup anchor={anchor} onClose={onClose}>
      <div className="weight-popup__header">
        <span>{item.nameAr}</span>
        <span className="weight-popup__price">اختر الحجم</span>
      </div>
      <div className="weight-popup__shortcuts">
        {(item.sizeOptions ?? []).map((size) => (
          <button
            key={size.id}
            type="button"
            className="weight-popup__btn"
            onClick={() => { onSelect(size); onClose() }}
          >
            <span>{size.labelAr}</span>
            <span>{size.price.toFixed(2)}</span>
          </button>
        ))}
      </div>
    </FloatingPopup>
  )
}

function AddonPopup({
  item,
  anchor,
  onConfirm,
  onClose
}: {
  item: MenuItem
  anchor: DOMRect
  onConfirm: (selected: MenuItemAttachment[]) => void
  onClose: () => void
}): React.ReactElement {
  const attachments = item.attachments ?? []
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  function toggle(id: string): void {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id])
  }

  return (
    <FloatingPopup anchor={anchor} onClose={onClose}>
      <div className="weight-popup__header">
        <span>{item.nameAr}</span>
        <span className="weight-popup__price">اختيار المرفقات</span>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {attachments.map((attachment) => (
          <label
            key={attachment.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '8px 10px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.04)',
              cursor: 'pointer'
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={selectedIds.includes(attachment.id)}
                onChange={() => toggle(attachment.id)}
              />
              <span>{attachment.nameAr}</span>
            </span>
            <span>{attachment.price.toFixed(2)}</span>
          </label>
        ))}
      </div>
      <div className="modal-actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => {
            onConfirm(attachments.filter((attachment) => selectedIds.includes(attachment.id)))
            onClose()
          }}
        >
          إضافة
        </button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={onClose}>
          إلغاء
        </button>
      </div>
    </FloatingPopup>
  )
}

// ── Opening cash modal ────────────────────────────────────────────────────

function OpeningCashModal({
  onConfirm,
  onCancel
}: {
  onConfirm: (amount: number) => void
  onCancel: () => void
}): React.ReactElement {
  const [value, setValue] = useState('')

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
        <div className="order-details__header">
          <h2 className="order-details__title">فتح الشيفت</h2>
        </div>
        <p style={{ marginBottom: 16, fontSize: '0.9rem', color: 'var(--color-muted)' }}>
          أدخل مبلغ الكاش الموجود في الدرج عند بدء الشيفت
        </p>
        <label className="field">
          <span>مبلغ الافتتاح</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0.00"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') onConfirm(Number(value) || 0)
            }}
          />
        </label>
        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onConfirm(Number(value) || 0)}
          >
            فتح الشيفت
          </button>
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Close shift modal (replaces window.confirm + window.prompt) ───────────

function CloseShiftModal({
  unpaidCount,
  onConfirm,
  onCancel
}: {
  unpaidCount: number
  onConfirm: (closingCash: number | undefined) => void
  onCancel: () => void
}): React.ReactElement {
  const [cashValue, setCashValue] = useState('')

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="order-details__header">
          <h2 className="order-details__title">تقفيل الشيفت</h2>
          <button type="button" className="order-details__close" onClick={onCancel} aria-label="إغلاق">✕</button>
        </div>

        {unpaidCount > 0 && (
          <div style={{
            background: '#fef3c7',
            border: '2px solid #f59e0b',
            borderRadius: 6,
            padding: '8px 12px',
            marginBottom: 14,
            fontSize: '0.85rem',
            fontWeight: 700,
            color: '#92400e'
          }}>
            ⚠️ يوجد {unpaidCount} طلب غير مدفوع في الصالة
          </div>
        )}

        <label className="field">
          <span>الكاش الفعلي في الدرج عند الإغلاق (اختياري)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={cashValue}
            onChange={(e) => setCashValue(e.target.value)}
            placeholder="0.00"
            autoFocus
          />
        </label>
        <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', margin: '4px 0 16px' }}>
          اترك الحقل فارغاً إذا لم تريد إدخال مبلغ الإغلاق
        </p>

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              const parsed = Number(cashValue)
              onConfirm(cashValue.trim() !== '' && !isNaN(parsed) ? parsed : undefined)
            }}
          >
            تأكيد التقفيل
          </button>
          <button type="button" className="btn btn--secondary" onClick={onCancel}>إلغاء</button>
        </div>
      </div>
    </div>
  )
}

// ── Confirm dine-in occupied table modal ──────────────────────────────────

function OccupiedTableModal({
  tableNameAr,
  onConfirm,
  onCancel
}: {
  tableNameAr: string
  onConfirm: () => void
  onCancel: () => void
}): React.ReactElement {
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
        <div className="order-details__header">
          <h2 className="order-details__title">الترابيزة مشغولة</h2>
          <button type="button" className="order-details__close" onClick={onCancel} aria-label="إغلاق">✕</button>
        </div>
        <p style={{ marginBottom: 20, fontSize: '0.9rem' }}>
          الترابيزة <strong>{tableNameAr}</strong> عليها طلب غير مدفوع. هل تريد إضافة طلب جديد عليها؟
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn--primary" onClick={onConfirm}>نعم، أضف طلب</button>
          <button type="button" className="btn btn--secondary" onClick={onCancel}>إلغاء</button>
        </div>
      </div>
    </div>
  )
}

// ── REQ-3: Held order type (module-scope so no hoisting issues) ──────────
interface HeldOrder {
  id: string
  cart: LocalCartLine[]
  orderType: OrderType
  orderNote: string
  selectedTableId: string
  customerName: string
  customerPhone: string
  customerAddress: string
  deliveryFee: string
  discountType: DiscountType
  discountValue: string
  label: string
}

// ── Main POS page ─────────────────────────────────────────────────────────

export function PosPage(): React.ReactElement {
  const user = useAuthStore((s) => s.user)!

  // Menu data
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [unavailableItems, setUnavailableItems] = useState<Map<string, string>>(new Map())
  const [lowStockItems, setLowStockItems] = useState<Set<string>>(new Set())
  const [selectedCategory, setSelectedCategory] = useState<string | 'all'>('all')
  const [search, setSearch] = useState('')

  // Cart
  const [cart, setCart] = useState<LocalCartLine[]>([])
  const [orderType, setOrderType] = useState<OrderType>('takeaway')
  const [orderNote, setOrderNote] = useState('')

  // Tables
  const [tables, setTables] = useState<DiningTable[]>([])
  const [unpaidOrders, setUnpaidOrders] = useState<Order[]>([])
  const [selectedTableId, setSelectedTableId] = useState('')
  const [tablePopupOpen, setTablePopupOpen] = useState(false)

  // Item popups
  const [weightPopup, setWeightPopup] = useState<{ item: MenuItem; rect: DOMRect } | null>(null)
  const [sizePopup, setSizePopup] = useState<{ item: MenuItem; rect: DOMRect } | null>(null)
  const [addonPopup, setAddonPopup] = useState<PendingCartSelection | null>(null)

  // UI state
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  // Edit mode
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)

  // ── REQ-6: Discount limit per role ───────────────────────────────────
  const [maxDiscountPct, setMaxDiscountPct] = useState<number | undefined>(undefined)

  // ── REQ-1: Checkout modal ─────────────────────────────────────────────
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [checkoutMethod, setCheckoutMethod] = useState<'cash' | 'card' | 'split'>('cash')
  const [cashReceived, setCashReceived] = useState('')
  const [splitCash, setSplitCash] = useState('')
  const [splitCard, setSplitCard] = useState('')
  const [discountType, setDiscountType] = useState<DiscountType>('percent')
  const [discountValue, setDiscountValue] = useState('')
  const [deliveryFee, setDeliveryFee] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')

  // ── REQ-3: Hold / Park orders ────────────────────────────────────────
  const [heldOrders, setHeldOrders] = useState<HeldOrder[]>([])
  const [heldPanelOpen, setHeldPanelOpen] = useState(false)

  function holdCurrentOrder(): void {
    if (cart.length === 0) return
    if (heldOrders.length >= 10) {
      setMessage('الحد الأقصى للطلبات المعلقة هو 10')
      return
    }
    const held: HeldOrder = {
      id: crypto.randomUUID(),
      cart,
      orderType,
      orderNote,
      selectedTableId,
      customerName,
      customerPhone,
      customerAddress,
      deliveryFee,
      discountType,
      discountValue,
      label: `${orderType === 'dine_in' ? `صالة ${selectedTable?.nameAr ?? ''}` : orderType === 'delivery' ? `دليفري ${customerName}` : 'تيك أواي'} — ${cart.length} صنف`
    }
    setHeldOrders((prev) => [...prev, held])
    setCart([])
    setOrderNote('')
    setMessage('تم تعليق الطلب')
  }

  function resumeHeldOrder(held: HeldOrder): void {
    if (cart.length > 0) {
      holdCurrentOrder()
    }
    setCart(held.cart)
    setOrderType(held.orderType)
    setOrderNote(held.orderNote)
    setSelectedTableId(held.selectedTableId)
    setCustomerName(held.customerName)
    setCustomerPhone(held.customerPhone)
    setCustomerAddress(held.customerAddress)
    setDeliveryFee(held.deliveryFee)
    setDiscountType(held.discountType)
    setDiscountValue(held.discountValue)
    setHeldOrders((prev) => prev.filter((h) => h.id !== held.id))
    setHeldPanelOpen(false)
    setMessage('تم استعادة الطلب')
  }

  function discardHeldOrder(id: string): void {
    setHeldOrders((prev) => prev.filter((h) => h.id !== id))
  }
  // Pending action to run after the cashier confirms opening cash
  const [openingCashModal, setOpeningCashModal] = useState(false)
  const [pendingCheckoutAfterShift, setPendingCheckoutAfterShift] = useState<null | (() => Promise<void>)>(null)

  // ── REQ-13: Close shift modal ─────────────────────────────────────────
  const [closeShiftModal, setCloseShiftModal] = useState(false)
  const [closeShiftUnpaidCount, setCloseShiftUnpaidCount] = useState(0)

  // Occupied table confirmation modal
  const [occupiedTableModal, setOccupiedTableModal] = useState(false)
  const [pendingOccupiedTable, setPendingOccupiedTable] = useState<DiningTable | null>(null)

  // ── Load menu & tables ────────────────────────────────────────────────

  const load = useCallback(async () => {
    const [cats, menu, stocks, diningTables, unpaid] = await Promise.all([
      listCategories(),
      listMenuItems(true),
      getIngredientStocks(),
      listDiningTables(),
      listUnpaidDineInOrders()
    ])
    setCategories(cats.filter((c) => c.active))
    setItems(menu)
    setTables(diningTables)
    setUnpaidOrders(unpaid)
    if (diningTables.length > 0) setSelectedTableId((prev) => prev || diningTables[0]!.id)

    const outOfStock = new Map<string, string>()
    const lowStock = new Set<string>()
    for (const stock of stocks) {
      if (stock.quantity <= 0) outOfStock.set(stock.ingredientId, stock.nameAr)
      else if (stock.lowStockThreshold != null && stock.quantity <= stock.lowStockThreshold) {
        lowStock.add(stock.ingredientId)
      }
    }

    const unavailable = new Map<string, string>()
    const lowItems = new Set<string>()
    const stockByIngredientId = new Map(stocks.map((stock) => [stock.ingredientId, stock]))
    await Promise.all(
      menu.map(async (item) => {
        if (item.linkedIngredientId) {
          const linkedStock = stockByIngredientId.get(item.linkedIngredientId)
          if (linkedStock) {
            if (linkedStock.quantity <= 0) {
              unavailable.set(item.id, linkedStock.nameAr)
              return
            }
            if (
              linkedStock.lowStockThreshold != null &&
              linkedStock.quantity <= linkedStock.lowStockThreshold
            ) {
              lowItems.add(item.id)
            }
          }
        }
        const recipe = await getRecipeByMenuItem(item.id)
        if (!recipe) return
        for (const line of recipe.lines) {
          if (outOfStock.has(line.ingredientId)) {
            unavailable.set(item.id, outOfStock.get(line.ingredientId)!)
            break
          }
          if (lowStock.has(line.ingredientId)) lowItems.add(item.id)
        }
      })
    )
    setUnavailableItems(unavailable)
    setLowStockItems(lowItems)
  }, [])

  useEffect(() => { void load() }, [load])

  // ── Derived values ────────────────────────────────────────────────────

  const categoryChildren = useMemo(() => {
    const children = new Map<string, MenuCategory[]>()
    for (const cat of categories) {
      if (!cat.parentId) continue
      children.set(cat.parentId, [...(children.get(cat.parentId) ?? []), cat])
    }
    return children
  }, [categories])

  const filteredItems = useMemo(() => {
    let list = items
    if (selectedCategory !== 'all') {
      const visibleIds = new Set([
        selectedCategory,
        ...(categoryChildren.get(selectedCategory)?.map((c) => c.id) ?? [])
      ])
      list = list.filter((item) => visibleIds.has(item.categoryId))
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((item) => item.nameAr.toLowerCase().includes(q))
    }
    return list
  }, [categoryChildren, items, selectedCategory, search])

  const subtotal = orderSubtotal(cart)
  const discountAmt = computeDiscount(
    subtotal,
    discountValue ? discountType : undefined,
    discountValue ? Number(discountValue) : undefined
  )
  const taxAmt = computeTax(subtotal - discountAmt, 0) // actual tax rate applied at submit time
  const deliveryFeeNum = orderType === 'delivery' ? (Number(deliveryFee) || 0) : 0
  const total = orderTotal(subtotal, discountAmt, taxAmt, deliveryFeeNum)

  // REQ-1: change due when cash payment
  const cashReceivedNum = Number(cashReceived) || 0
  const changeDue = checkoutMethod === 'cash' ? Math.max(0, cashReceivedNum - total) : 0
  const cashInsufficient = checkoutMethod === 'cash' && cashReceived.trim() !== '' && cashReceivedNum < total

  // REQ-6: discount over-limit check
  const isDiscountLimited = user.role === 'cashier' && maxDiscountPct != null && maxDiscountPct < 100
  const appliedDiscountPct = discountType === 'percent' ? Number(discountValue) || 0 : 0
  const discountOverLimit = isDiscountLimited && discountType === 'percent' && appliedDiscountPct > (maxDiscountPct ?? 100)

  const occupiedTableIds = useMemo(
    () => new Set(unpaidOrders.map((o) => o.tableId).filter(Boolean) as string[]),
    [unpaidOrders]
  )
  const selectedTable = useMemo(
    () => tables.find((t) => t.id === selectedTableId),
    [tables, selectedTableId]
  )
  const groupedTables = useMemo(() => {
    const groups = new Map<string, DiningTable[]>()
    for (const t of tables) {
      const key = t.categoryAr?.trim() || 'بدون تصنيف'
      groups.set(key, [...(groups.get(key) ?? []), t])
    }
    return Array.from(groups.entries()).map(([category, tbls]) => ({ category, tables: tbls }))
  }, [tables])

  // ── Cart helpers ──────────────────────────────────────────────────────

  function cartKey(item: MenuItem, quantity: number, unitPrice: number, size?: MenuItemSizeOption): string {
    return cartKeyWithAttachments(item, quantity, unitPrice, size)
  }

  function cartKeyWithAttachments(
    item: MenuItem,
    quantity: number,
    unitPrice: number,
    size?: MenuItemSizeOption,
    attachments: MenuItemAttachment[] = []
  ): string {
    const suffix = attachments.length > 0
      ? `:a:${attachments.map((attachment) => attachment.id).sort().join(',')}`
      : ''
    if (item.isWeighted) return `${item.id}:w:${quantity.toFixed(3)}:${unitPrice.toFixed(4)}${suffix}`
    if (size) return `${item.id}:s:${size.id}${suffix}`
    return item.id
  }

  function openAddonsOrAddToCart(selection: PendingCartSelection): void {
    if ((selection.item.attachments?.length ?? 0) > 0) {
      setAddonPopup(selection)
      return
    }
    addToCart(selection.item, selection.quantity, selection.unitPrice, selection.size)
  }

  function addToCart(
    item: MenuItem,
    quantity = 1,
    unitPrice = item.price,
    size?: MenuItemSizeOption,
    selectedAttachments: MenuItemAttachment[] = []
  ): void {
    if (unavailableItems.has(item.id)) return
    const key = cartKeyWithAttachments(item, quantity, unitPrice, size, selectedAttachments)
    const mainLine: LocalCartLine = {
      key,
      menuItemId: item.id,
      nameAr: item.nameAr,
      unitPrice,
      quantity,
      sizeLabelAr: size?.labelAr,
      unitLabel: item.isWeighted ? 'كجم' : undefined,
      weightGrams: item.isWeighted ? Math.round(quantity * 1000) : undefined
    }
    const attachmentLines: LocalCartLine[] = selectedAttachments.map((att) => ({
      key: `${key}:att:${att.id}`,
      parentKey: key,
      menuItemId: `${item.id}:attachment:${att.id}`,
      attachmentForMenuItemId: item.id,
      nameAr: `+ ${att.nameAr}`,
      unitPrice: att.price,
      quantity
    }))

    setCart((prev) => {
      const existing = prev.find((line) => line.key === key)
      if (existing) {
        return prev.map((line) => {
          if (line.key === key || line.parentKey === key) {
            const nextQty = line.quantity + quantity
            return {
              ...line,
              quantity: nextQty,
              weightGrams: line.unitLabel ? Math.round(nextQty * 1000) : line.weightGrams
            }
          }
          return line
        })
      }
      return [...prev, mainLine, ...attachmentLines]
    })
  }

  function changeQty(key: string, delta: number): void {
    setCart((prev) => {
      const target = prev.find((line) => line.key === key)
      const affectedKey = target?.parentKey ? key : key
      return prev
        .map((line) => {
          if (line.key !== affectedKey && line.parentKey !== affectedKey) return line
          const nextQty = Math.max(0, line.quantity + delta)
          return {
            ...line,
            quantity: nextQty,
            weightGrams: line.unitLabel ? Math.round(nextQty * 1000) : line.weightGrams
          }
        })
        .filter((line) => line.quantity > 0)
    })
  }

  function resetCheckoutFields(): void {
    setCashReceived('')
    setSplitCash('')
    setSplitCard('')
    setDiscountValue('')
    setDeliveryFee('')
    setCustomerName('')
    setCustomerPhone('')
    setCustomerAddress('')
  }

  // ── REQ-2: Ensure shift open with opening cash prompt ─────────────────
  /**
   * Returns true when the shift is already open.
   * Returns false and opens the opening-cash modal if no shift exists yet —
   * the caller must pass `proceed` which will be called after the cashier
   * enters opening cash.
   */
  async function ensureShiftOrPrompt(proceed: () => Promise<void>): Promise<boolean> {
    const existing = await getOpenShiftForCashier(user.id)
    if (existing) return true
    // No open shift — prompt for opening cash before proceeding
    setPendingCheckoutAfterShift(() => proceed)
    setOpeningCashModal(true)
    return false
  }

  async function handleOpeningCashConfirm(amount: number): Promise<void> {
    setOpeningCashModal(false)
    // Open the shift with the given opening cash
    await ensureOpenShift({
      cashierId: user.id,
      cashierName: user.displayName,
      cashierCode: user.cashierCode,
      openingCash: amount
    })
    // Now run the pending checkout action
    if (pendingCheckoutAfterShift) {
      const fn = pendingCheckoutAfterShift
      setPendingCheckoutAfterShift(null)
      await fn()
    }
  }

  // ── Checkout for takeaway / delivery ─────────────────────────────────

  function openCheckoutModal(method?: 'cash' | 'card' | 'split'): void {
    if (method) setCheckoutMethod(method)
    // REQ-6: load discount limit once when modal opens
    void getSettings().then((s) => setMaxDiscountPct(s.maxCashierDiscountPct))
    setCheckoutOpen(true)
  }

  function printKitchenAfterSave(order: Order, orderItems: Awaited<ReturnType<typeof getOrderItems>>, settings: Awaited<ReturnType<typeof getSettings>>, successPrefix: string): void {
    printKitchenTickets(order, orderItems, settings).then((result) => {
      if (!result.ok) {
        setMessage(`${successPrefix}، لكن فشلت طباعة التجهيز: ${result.failed.map((f) => f.printerName).join('، ')}`)
      }
    }).catch(() => {})
  }

  async function submitCheckout(): Promise<void> {
    if (cart.length === 0) return

    // REQ-6: enforce discount limit for cashiers
    if (discountOverLimit) {
      setMessage(`الخصم يتجاوز الحد المسموح به (${maxDiscountPct}%) — يتطلب موافقة المدير`)
      return
    }

    // REQ-1 validation: cash received must cover the total
    if (checkoutMethod === 'cash') {
      if (cashReceived.trim() !== '' && cashReceivedNum < total) {
        setMessage('المبلغ المستلم أقل من الإجمالي')
        return
      }
    }

    // Split validation
    const cashPaid = checkoutMethod === 'split' ? Number(splitCash) || 0 : undefined
    const cardPaid = checkoutMethod === 'split' ? Number(splitCard) || 0 : undefined
    if (checkoutMethod === 'split' && (cashPaid! + cardPaid!) < total - 0.01) {
      setMessage('مجموع الدفع أقل من الإجمالي')
      return
    }

    setLoading(true)
    setMessage('')
    try {
      const order = await completeOrder({
        cashierId: user.id,
        cashierName: user.displayName,
        cashierCode: user.cashierCode,
        lines: cart,
        orderNoteAr: orderNote || undefined,
        orderType,
        paymentMethod: checkoutMethod,
        cashPaid,
        cardPaid,
        discountType: discountValue ? discountType : undefined,
        discountValue: discountValue ? Number(discountValue) : undefined,
        deliveryFee: orderType === 'delivery' ? Number(deliveryFee) || 0 : undefined,
        customerName: customerName || undefined,
        customerPhone: customerPhone || undefined,
        customerAddress: customerAddress || undefined
      })
      const [orderItems, settings] = await Promise.all([getOrderItems(order.id), getSettings()])
      setCart([])
      setOrderNote('')
      setCheckoutOpen(false)
      resetCheckoutFields()
      setMessage(`تم إتمام الطلب #${orderReference(order)}`)
      printReceipt(order, orderItems, settings).catch(() => {})
      printKitchenAfterSave(order, orderItems, settings, 'تم حفظ الطلب')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'فشل')
    } finally {
      setLoading(false)
    }
  }

  // ── Dine-in order ─────────────────────────────────────────────────────

  async function submitDineIn(table: DiningTable): Promise<void> {
    setLoading(true)
    setMessage('')
    try {
      const order = await completeOrder({
        cashierId: user.id,
        cashierName: user.displayName,
        cashierCode: user.cashierCode,
        lines: cart,
        orderNoteAr: orderNote || undefined,
        orderType: 'dine_in',
        table: { id: table.id, nameAr: table.nameAr, categoryAr: table.categoryAr }
      })
      const [orderItems, settings, unpaid] = await Promise.all([
        getOrderItems(order.id),
        getSettings(),
        listUnpaidDineInOrders()
      ])
      setCart([])
      setOrderNote('')
      setUnpaidOrders(unpaid)
      setMessage(`تم إنشاء طلب صالة #${orderReference(order)}`)
      printReceipt(order, orderItems, settings).catch(() => {})
      printKitchenAfterSave(order, orderItems, settings, 'تم حفظ الطلب')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'فشل')
    } finally {
      setLoading(false)
    }
  }

  // ── Checkout dispatcher ───────────────────────────────────────────────

  async function handleCheckout(method?: 'cash' | 'card'): Promise<void> {
    if (cart.length === 0) return

    if (orderType === 'dine_in') {
      if (!selectedTable) { setMessage('اختر ترابيزة لطلب الصالة'); return }

      if (occupiedTableIds.has(selectedTable.id)) {
        // Show modal instead of window.confirm
        setPendingOccupiedTable(selectedTable)
        setOccupiedTableModal(true)
        return
      }

      const table = selectedTable
      const action = async (): Promise<void> => submitDineIn(table)
      const ready = await ensureShiftOrPrompt(action)
      if (ready) await action()
      return
    }

    // Takeaway / delivery: open checkout modal
    const action = async (): Promise<void> => {
      if (method) setCheckoutMethod(method)
      else if (orderType === 'delivery') setCheckoutMethod('cash')
      // REQ-6: load discount limit
      void getSettings().then((s) => setMaxDiscountPct(s.maxCashierDiscountPct))
      setCheckoutOpen(true)
    }
    const ready = await ensureShiftOrPrompt(action)
    if (ready) await action()
  }

  // ── Edit order mode ───────────────────────────────────────────────────

  async function handleEditOrder(order: Order): Promise<void> {
    const existingItems = await getOrderItems(order.id)
    const lines: LocalCartLine[] = existingItems.map((item) => ({
      key: `edit:${item.id}`,
      menuItemId: item.menuItemId,
      nameAr: item.nameAr,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      sizeLabelAr: item.sizeLabelAr,
      unitLabel: item.unitLabel,
      weightGrams: item.weightGrams,
      noteAr: item.noteAr
    }))
    setCart(lines)
    setOrderNote(order.noteAr ?? '')
    setEditingOrder(order)
    setMessage(`تعديل طلب #${orderReference(order)}`)
  }

  async function submitEditOrder(): Promise<void> {
    if (!editingOrder || cart.length === 0) return
    setLoading(true)
    setMessage('')
    try {
      const order = await editOrderItems({
        orderId: editingOrder.id,
        cashierId: user.id,
        lines: cart,
        orderNoteAr: orderNote || undefined
      })
      const [orderItems, settings] = await Promise.all([getOrderItems(order.id), getSettings()])
      setCart([])
      setOrderNote('')
      setEditingOrder(null)
      printKitchenAfterSave(order, orderItems, settings, 'تم تعديل الطلب')
      const unpaid = await listUnpaidDineInOrders()
      setUnpaidOrders(unpaid)
      setMessage('تم تعديل الطلب بنجاح')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'فشل التعديل')
    } finally {
      setLoading(false)
    }
  }

  // ── REQ-13: Close shift (React modal instead of window.prompt) ────────

  async function handleCloseShift(): Promise<void> {
    const shift = await getOpenShiftForCashier(user.id)
    if (!shift) { setMessage('لا يوجد شيفت مفتوح'); return }
    const unpaidCount = (await listUnpaidDineInOrders()).length
    setCloseShiftUnpaidCount(unpaidCount)
    setCloseShiftModal(true)
  }

  async function confirmCloseShift(closingCash: number | undefined): Promise<void> {
    setCloseShiftModal(false)
    const shift = await getOpenShiftForCashier(user.id)
    if (!shift) return
    await closeShift(shift.id, user.id, closingCash)
    setMessage('تم تقفيل الشيفت')
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="pos-layout">

      {/* ── REQ-2: Opening cash modal ── */}
      {openingCashModal && (
        <OpeningCashModal
          onConfirm={(amount) => void handleOpeningCashConfirm(amount)}
          onCancel={() => {
            setOpeningCashModal(false)
            setPendingCheckoutAfterShift(null)
          }}
        />
      )}

      {/* ── REQ-13: Close shift modal ── */}
      {closeShiftModal && (
        <CloseShiftModal
          unpaidCount={closeShiftUnpaidCount}
          onConfirm={(cash) => void confirmCloseShift(cash)}
          onCancel={() => setCloseShiftModal(false)}
        />
      )}

      {/* ── Occupied table confirmation modal ── */}
      {occupiedTableModal && pendingOccupiedTable && (
        <OccupiedTableModal
          tableNameAr={pendingOccupiedTable.nameAr}
          onConfirm={async () => {
            const table = pendingOccupiedTable
            setOccupiedTableModal(false)
            setPendingOccupiedTable(null)
            const action = async (): Promise<void> => submitDineIn(table)
            const ready = await ensureShiftOrPrompt(action)
            if (ready) await action()
          }}
          onCancel={() => {
            setOccupiedTableModal(false)
            setPendingOccupiedTable(null)
          }}
        />
      )}

      {/* ── Menu panel ── */}
      <section className="pos-menu">
        <input
          className="pos-search"
          placeholder="بحث في القائمة..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="pos-categories">
          <button
            type="button"
            className={`pos-cat-btn ${selectedCategory === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('all')}
          >
            الكل
          </button>
          {categories.filter((c) => !c.parentId).map((cat) => (
            <div key={cat.id} className="pos-category-group">
              <button
                type="button"
                className={`pos-cat-btn ${selectedCategory === cat.id ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat.id)}
              >
                {cat.nameAr}
              </button>
              {categoryChildren.get(cat.id)?.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  className={`pos-cat-btn ${selectedCategory === child.id ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(child.id)}
                >
                  {child.nameAr}
                </button>
              ))}
            </div>
          ))}
          {categories
            .filter((c) => c.parentId && !categories.some((p) => p.id === c.parentId))
            .map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`pos-cat-btn ${selectedCategory === cat.id ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat.id)}
              >
                {cat.nameAr}
              </button>
            ))}
        </div>

        <div className="pos-items">
          {filteredItems.map((item) => {
            const outReason = unavailableItems.get(item.id)
            const isUnavailable = !!outReason
            const isLow = !isUnavailable && lowStockItems.has(item.id)
            const hasSizes = !item.isWeighted && (item.sizeOptions?.length ?? 0) > 0
            const priceLabel = item.isWeighted
              ? item.allowCustomWeight
                ? `${(item.customWeightUnitPrice ?? item.price).toFixed(2)} / كجم`
                : 'أسعار محددة'
              : hasSizes
                ? 'أحجام'
                : item.price.toFixed(2)

            return (
              <div
                key={item.id}
                className={`pos-item-wrap${isUnavailable ? ' pos-item-wrap--unavailable' : ''}${isLow ? ' pos-item-wrap--low' : ''}`}
              >
                <button
                  type="button"
                  className="pos-item-btn"
                  disabled={isUnavailable}
                  onClick={(e) => {
                    if (isUnavailable) return
                    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
                    if (item.isWeighted) setWeightPopup({ item, rect })
                    else if (hasSizes) setSizePopup({ item, rect })
                    else openAddonsOrAddToCart({ item, quantity: 1, unitPrice: item.price, anchor: rect })
                  }}
                >
                  {item.nameAr}
                  <span className="pos-item-btn__price">{priceLabel}</span>
                  {isLow && <span className="pos-item-badge pos-item-badge--low">قرب النفاد</span>}
                </button>
                {isUnavailable && (
                  <div className="pos-item-overlay">
                    <span className="pos-item-overlay__reason">نفذ: {outReason}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Item popups ── */}
      {weightPopup && (
        <WeightPopup
          item={weightPopup.item}
          anchor={weightPopup.rect}
          onSelect={(kg, unitPrice) => openAddonsOrAddToCart({
            item: weightPopup.item,
            quantity: kg,
            unitPrice,
            anchor: weightPopup.rect
          })}
          onClose={() => setWeightPopup(null)}
        />
      )}
      {sizePopup && (
        <SizePopup
          item={sizePopup.item}
          anchor={sizePopup.rect}
          onSelect={(size) => openAddonsOrAddToCart({
            item: sizePopup.item,
            quantity: 1,
            unitPrice: size.price,
            size,
            anchor: sizePopup.rect
          })}
          onClose={() => setSizePopup(null)}
        />
      )}
      {addonPopup && (
        <AddonPopup
          item={addonPopup.item}
          anchor={addonPopup.anchor}
          onConfirm={(selectedAttachments) => {
            addToCart(
              addonPopup.item,
              addonPopup.quantity,
              addonPopup.unitPrice,
              addonPopup.size,
              selectedAttachments
            )
            setAddonPopup(null)
          }}
          onClose={() => setAddonPopup(null)}
        />
      )}

      {/* ── Table picker modal — visual floor map ── */}
      {tablePopupOpen && (
        <div className="modal-overlay" onClick={() => setTablePopupOpen(false)}>
          <div className="modal fmp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="order-details__header">
              <h2 className="order-details__title">اختيار الترابيزة</h2>
              <button
                type="button"
                className="order-details__close"
                onClick={() => setTablePopupOpen(false)}
                aria-label="إغلاق"
              >
                ✕
              </button>
            </div>
            <FloorMapPicker
              tables={tables}
              occupiedIds={occupiedTableIds}
              selectedId={selectedTableId}
              onSelect={(id) => {
                setSelectedTableId(id)
                setTablePopupOpen(false)
              }}
            />
          </div>
        </div>
      )}

      {/* ── Cart sidebar ── */}
      <aside className="pos-cart">
        <div className="pos-cart__header">
          <span>الطلب</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* REQ-3: Held orders badge — in header, always visible */}
            {heldOrders.length > 0 && (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                style={{ position: 'relative', paddingInlineEnd: 22 }}
                onClick={() => setHeldPanelOpen(true)}
                title="عرض الطلبات المعلقة"
              >
                معلقة
                <span style={{
                  position: 'absolute',
                  top: -6,
                  insetInlineEnd: -6,
                  background: 'var(--color-primary)',
                  color: '#fff',
                  borderRadius: '50%',
                  width: 18,
                  height: 18,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.7rem',
                  fontWeight: 900,
                  lineHeight: 1
                }}>
                  {heldOrders.length}
                </span>
              </button>
            )}
            <button
              type="button"
              className="btn btn--secondary btn--sm pos-cart__shift-btn"
              onClick={() => void handleCloseShift()}
            >
              تقفيل الشيفت
            </button>
          </div>
        </div>

        {/* Order type toggle */}
        <div className="order-service-panel">
          <div className="order-type-toggle">
            {(['takeaway', 'dine_in', 'delivery'] as const).map((type) => (
              <button
                key={type}
                type="button"
                className={`order-type-toggle__btn${orderType === type ? ' order-type-toggle__btn--active' : ''}`}
                onClick={() => setOrderType(type)}
              >
                {type === 'takeaway' ? 'تيك أواي' : type === 'dine_in' ? 'صالة' : 'دليفري'}
              </button>
            ))}
          </div>
          {orderType === 'dine_in' && (
            <button
              type="button"
              className={`table-picker-trigger${selectedTable ? ' table-picker-trigger--selected' : ''}${selectedTable && occupiedTableIds.has(selectedTable.id) ? ' table-picker-trigger--occupied' : ''}`}
              onClick={() => setTablePopupOpen(true)}
            >
              <span>الترابيزة</span>
              <strong>
                {selectedTable
                  ? `${selectedTable.nameAr}${selectedTable.categoryAr ? ` - ${selectedTable.categoryAr}` : ''}`
                  : tables.length ? 'اختيار ترابيزة' : 'لا توجد ترابيزات'}
              </strong>
            </button>
          )}
        </div>

        {/* Cart lines */}
        <div className="pos-cart__lines">
          {cart.length === 0 && (
            <div className="pos-cart__empty">
              <img src="/image.png" alt="شعار المطعم" className="pos-cart__logo" />
              <p className="pos-cart__empty-text">أضف أصنافًا من القائمة</p>
            </div>
          )}
          {cart.map((line) => (
            <div key={line.key} className={`cart-line${line.parentKey ? ' cart-line--attachment' : ''}`}>
              <div>
                <div className="cart-line__name">{line.nameAr}</div>
                <div>
                  {lineTotal(line.unitPrice, line.quantity).toFixed(2)}
                  {line.sizeLabelAr && (
                    <span style={{ color: 'var(--color-muted)', marginInlineStart: 6 }}>
                      ({line.sizeLabelAr})
                    </span>
                  )}
                  {line.unitLabel && (
                    <span style={{ color: 'var(--color-muted)', marginInlineStart: 6 }}>
                      ({line.quantity.toFixed(3)} {line.unitLabel})
                    </span>
                  )}
                </div>
              </div>
              <div className="cart-line__controls">
                {!line.parentKey && (
                  <button type="button" className="qty-btn" onClick={() => changeQty(line.key, -1)}>
                    -
                  </button>
                )}
                <span>{line.unitLabel ? line.quantity.toFixed(2) : line.quantity}</span>
                {!line.parentKey && (
                  <button type="button" className="qty-btn" onClick={() => changeQty(line.key, 1)}>
                    +
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="pos-cart__footer">
          <textarea
            className="order-note"
            placeholder="ملاحظة على الطلب..."
            value={orderNote}
            onChange={(e) => setOrderNote(e.target.value)}
          />

          {/* Cart totals summary */}
          <div className="cart-summary">
            {discountAmt > 0 && (
              <div style={{ fontSize: '0.82rem', color: 'var(--color-muted)' }}>
                <span>المجموع الفرعي</span>
                <span style={{ marginInlineStart: 8 }}>{subtotal.toFixed(2)}</span>
              </div>
            )}
            {discountAmt > 0 && (
              <div style={{ fontSize: '0.82rem', color: 'var(--color-danger)' }}>
                <span>خصم</span>
                <span style={{ marginInlineStart: 8 }}>- {discountAmt.toFixed(2)}</span>
              </div>
            )}
            {deliveryFeeNum > 0 && (
              <div style={{ fontSize: '0.82rem', color: 'var(--color-muted)' }}>
                <span>رسوم التوصيل</span>
                <span style={{ marginInlineStart: 8 }}>{deliveryFeeNum.toFixed(2)}</span>
              </div>
            )}
            <div>
              <span>الإجمالي</span>
              <strong>{total.toFixed(2)}</strong>
            </div>
          </div>

          {message && (
            <p className={`form-message ${message.includes('فشل') || message.includes('أقل') ? 'form-message--error' : 'form-message--ok'}`}>
              {message}
            </p>
          )}

          {/* Edit mode banner */}
          {editingOrder && (
            <div style={{
              background: '#fef3c7',
              border: '2px solid #f59e0b',
              padding: '6px 10px',
              marginBottom: 8,
              fontSize: '0.82rem',
              fontWeight: 700
            }}>
              وضع تعديل طلب #{orderReference(editingOrder)}
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                style={{ marginInlineStart: 8 }}
                onClick={() => { setEditingOrder(null); setCart([]); setOrderNote('') }}
              >
                إلغاء
              </button>
            </div>
          )}

          {/* REQ-3: Hold Orders panel trigger — now in cart header */}

          {/* Checkout actions */}
          <div className="checkout-actions">
            {editingOrder ? (
              <button
                type="button"
                className="btn btn--primary"
                disabled={loading || cart.length === 0}
                onClick={() => void submitEditOrder()}
              >
                {loading ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
              </button>
            ) : orderType === 'takeaway' ? (
              <>
                {/* Hold button — secondary, above the payment row */}
                {cart.length > 0 && (
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    style={{ width: '100%', marginBottom: 6, opacity: 0.75, fontSize: '0.82rem' }}
                    onClick={holdCurrentOrder}
                    title="تعليق الطلب الحالي واستئنافه لاحقاً"
                  >
                    ⏸ تعليق الطلب
                  </button>
                )}
                {/* Primary payment row */}
                <div style={{ display: 'flex', gap: 6, width: '100%' }}>
                  <button
                    type="button"
                    className="btn btn--primary"
                    style={{ flex: 2 }}
                    disabled={loading || cart.length === 0}
                    onClick={() => void handleCheckout('cash')}
                  >
                    نقدي
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    style={{ flex: 1 }}
                    disabled={loading || cart.length === 0}
                    onClick={() => void handleCheckout('card')}
                  >
                    بطاقة
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    style={{ flex: 1 }}
                    disabled={loading || cart.length === 0}
                    onClick={() => {
                      setCheckoutMethod('split')
                      void handleCheckout()
                    }}
                  >
                    تقسيم
                  </button>
                </div>
              </>
            ) : orderType === 'dine_in' ? (
              <>
                {cart.length > 0 && (
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    style={{ width: '100%', marginBottom: 6, opacity: 0.75, fontSize: '0.82rem' }}
                    onClick={holdCurrentOrder}
                    title="تعليق الطلب الحالي"
                  >
                    ⏸ تعليق الطلب
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--primary"
                  style={{ width: '100%' }}
                  disabled={loading || cart.length === 0 || !selectedTable}
                  onClick={() => void handleCheckout()}
                >
                  {loading ? 'جارٍ...' : 'إنشاء طلب صالة'}
                </button>
              </>
            ) : (
              <>
                {cart.length > 0 && (
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    style={{ width: '100%', marginBottom: 6, opacity: 0.75, fontSize: '0.82rem' }}
                    onClick={holdCurrentOrder}
                    title="تعليق الطلب الحالي"
                  >
                    ⏸ تعليق الطلب
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--primary"
                  style={{ width: '100%' }}
                  disabled={loading || cart.length === 0}
                  onClick={() => void handleCheckout()}
                >
                  {loading ? 'جارٍ...' : 'إنشاء طلب دليفري'}
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* ── Checkout Modal ── */}
      {checkoutOpen && (
        <div className="modal-overlay" onClick={() => setCheckoutOpen(false)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="order-details__header">
              <h2 className="order-details__title">إتمام الطلب</h2>
              <button
                type="button"
                className="order-details__close"
                onClick={() => setCheckoutOpen(false)}
              >
                ✕
              </button>
            </div>

            {/* Payment method selector */}
            {orderType === 'takeaway' && (
              <div style={{ marginBottom: 14 }}>
                <p style={{ fontWeight: 700, marginBottom: 6 }}>طريقة الدفع</p>
                <div className="order-type-toggle">
                  {(['cash', 'card', 'split'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`order-type-toggle__btn${checkoutMethod === m ? ' order-type-toggle__btn--active' : ''}`}
                      onClick={() => { setCheckoutMethod(m); setCashReceived('') }}
                    >
                      {m === 'cash' ? 'نقدي' : m === 'card' ? 'بطاقة' : 'تقسيم'}
                    </button>
                  ))}
                </div>

                {/* REQ-1: Cash received + change calculator */}
                {checkoutMethod === 'cash' && (
                  <div style={{ marginTop: 10 }}>
                    <label className="field" style={{ margin: 0 }}>
                      <span>المبلغ المستلم من العميل</span>
                      <input
                        type="number"
                        min={total}
                        step="0.01"
                        value={cashReceived}
                        onChange={(e) => setCashReceived(e.target.value)}
                        placeholder={total.toFixed(2)}
                        autoFocus
                        style={{
                          border: cashInsufficient
                            ? '2px solid var(--color-danger)'
                            : '1.5px solid var(--color-border-light)'
                        }}
                      />
                    </label>
                    {cashInsufficient && (
                      <p style={{ color: 'var(--color-danger)', fontSize: '0.82rem', margin: '4px 0 0', fontWeight: 700 }}>
                        المبلغ المستلم أقل من الإجمالي
                      </p>
                    )}
                    {cashReceived.trim() !== '' && !cashInsufficient && changeDue >= 0 && (
                      <div style={{
                        background: 'var(--color-success, #15803d)',
                        color: '#fff',
                        borderRadius: 6,
                        padding: '10px 14px',
                        marginTop: 8,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontWeight: 900,
                        fontSize: '1.1rem'
                      }}>
                        <span>الباقي للعميل</span>
                        <span style={{ fontSize: '1.4rem' }}>{changeDue.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Split payment inputs */}
                {checkoutMethod === 'split' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <label className="field" style={{ flex: 1, margin: 0 }}>
                      <span>نقدي</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={splitCash}
                        onChange={(e) => setSplitCash(e.target.value)}
                        placeholder="0.00"
                      />
                    </label>
                    <label className="field" style={{ flex: 1, margin: 0 }}>
                      <span>بطاقة</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={splitCard}
                        onChange={(e) => setSplitCard(e.target.value)}
                        placeholder="0.00"
                      />
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* Discount */}
            <div style={{ marginBottom: 14 }}>
              <p style={{ fontWeight: 700, marginBottom: 6 }}>خصم (اختياري)</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value as DiscountType)}
                  style={{
                    minHeight: 34,
                    padding: '4px 8px',
                    border: '1.5px solid var(--color-border-light)',
                    borderRadius: 3,
                    fontFamily: 'inherit'
                  }}
                >
                  <option value="percent">نسبة %</option>
                  <option value="fixed">مبلغ ثابت</option>
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder={discountType === 'percent' ? '10' : '5.00'}
                  style={{
                    flex: 1,
                    minHeight: 34,
                    padding: '4px 8px',
                    border: discountOverLimit
                      ? '2px solid var(--color-danger)'
                      : '1.5px solid var(--color-border-light)',
                    borderRadius: 3,
                    fontFamily: 'inherit'
                  }}
                />
              </div>
              {/* REQ-6: over-limit warning */}
              {discountOverLimit && (
                <div style={{
                  background: '#fef2f2',
                  border: '1.5px solid var(--color-danger)',
                  borderRadius: 4,
                  padding: '6px 10px',
                  marginTop: 6,
                  fontSize: '0.82rem',
                  color: 'var(--color-danger)',
                  fontWeight: 700
                }}>
                  ⚠️ الخصم يتجاوز الحد المسموح به ({maxDiscountPct}%). يتطلب موافقة المدير.
                </div>
              )}
            </div>

            {/* Delivery info */}
            {orderType === 'delivery' && (
              <div style={{ marginBottom: 14 }}>
                <p style={{ fontWeight: 700, marginBottom: 6 }}>بيانات التوصيل</p>
                <label className="field">
                  <span>اسم العميل</span>
                  <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="اسم العميل" />
                </label>
                <label className="field">
                  <span>رقم الهاتف</span>
                  <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="01xxxxxxxxx" dir="ltr" />
                </label>
                <label className="field">
                  <span>العنوان</span>
                  <input value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} placeholder="العنوان التفصيلي" />
                </label>
                <label className="field">
                  <span>رسوم التوصيل</span>
                  <input type="number" min="0" step="0.01" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} placeholder="0.00" />
                </label>
              </div>
            )}

            {/* Order totals summary */}
            <div style={{
              background: 'var(--color-bg)',
              padding: '10px 12px',
              marginBottom: 14,
              border: '1px solid var(--color-border-light)',
              borderRadius: 4
            }}>
              {subtotal !== total && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--color-muted)' }}>
                  <span>المجموع الفرعي</span><span>{subtotal.toFixed(2)}</span>
                </div>
              )}
              {discountAmt > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--color-danger)' }}>
                  <span>خصم</span><span>- {discountAmt.toFixed(2)}</span>
                </div>
              )}
              {deliveryFeeNum > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span>رسوم التوصيل</span><span>{deliveryFeeNum.toFixed(2)}</span>
                </div>
              )}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontWeight: 900,
                fontSize: '1.1rem',
                borderTop: '2px solid var(--color-border)',
                marginTop: 6,
                paddingTop: 6
              }}>
                <span>الإجمالي</span>
                <span>{total.toFixed(2)}</span>
              </div>
            </div>

            {message && <p className="form-error">{message}</p>}

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={loading || cashInsufficient || discountOverLimit}
                onClick={() => void submitCheckout()}
              >
                {loading ? 'جارٍ...' : 'تأكيد الطلب'}
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setCheckoutOpen(false)}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── REQ-3: Held Orders panel ── */}
      {heldPanelOpen && (
        <div className="modal-overlay" onClick={() => setHeldPanelOpen(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="order-details__header">
              <h2 className="order-details__title">الطلبات المعلقة ({heldOrders.length})</h2>
              <button type="button" className="order-details__close" onClick={() => setHeldPanelOpen(false)} aria-label="إغلاق">✕</button>
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--color-muted)', marginBottom: 12 }}>
              اضغط على طلب لاستعادته إلى الكارت
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {heldOrders.map((held) => (
                <div
                  key={held.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 14px',
                    border: '1.5px solid var(--color-border-light)',
                    borderRadius: 6,
                    background: 'var(--color-bg)'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{held.label}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--color-muted)', marginTop: 2 }}>
                      {held.cart.filter((l) => !l.parentKey).length} صنف
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => resumeHeldOrder(held)}
                    >
                      استعادة
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      onClick={() => discardHeldOrder(held.id)}
                    >
                      حذف
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Export for use from OrderHistoryPage (edit mode)
export { type LocalCartLine }
// eslint-disable-next-line react-refresh/only-export-components
export { }
