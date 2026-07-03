import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppSettings,
  DiningTable,
  DiscountType,
  MenuCategory,
  ItemAddon,
  MenuItem,
  MenuItemAttachment,
  MenuItemSizeOption,
  Order,
  OrderType,
  DeliveryContact,
  Shift
} from '@shared/types'
import { getIngredientStocks } from '@renderer/features/inventory/inventory-service'
import { listCategories, listMenuItems, getRecipeByMenuItem } from '@renderer/features/menu/menu-service'
import { listAddons } from '@renderer/features/menu/addons-service'
import {
  completeOrder,
  editOrderItems,
  getSettings,
  listUnpaidDineInOrders,
  type CartLine
} from '@renderer/features/orders/order-service'
import { getOrderItems } from '@renderer/features/orders/order-service'
import { listDiningTables } from '@renderer/features/tables/table-service'
import { ConfirmDialog } from '@renderer/components/ui'
import { printReceipt } from '@renderer/features/receipt/receipt-builder'
import { printKitchenTickets } from '@renderer/features/printers/kitchen-printing'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import {
  createDeliveryContact,
  listDeliveryContacts,
  normalizePhone
} from '@renderer/features/contacts/delivery-contact-service'
import {
  orderSubtotal,
  orderTotal,
  computeDiscount,
  computeTax,
  computeService,
  effectiveTaxRate,
  effectiveServiceRate
} from '@shared/services/order-calculator'
import { orderReference } from '@shared/services/order-reference'
import {
  closeShift,
  ensureOpenShift,
  getOpenShiftForCashier,
  getShiftClosurePreview,
  type ShiftClosurePreview
} from '@renderer/features/shifts/shift-service'
import { FloorMapPicker } from './FloorMapPicker'
import {
  calculateAutomaticCashRounding,
  getCashRoundingAccess,
  type CashRoundingAccess
} from '@renderer/features/rounding/cash-rounding-service'

import { AddonPopup, SizePopup, WeightPopup } from './components/Popups'
import { CategoryBrowser } from './components/CategoryBrowser'
import { ItemGrid } from './components/ItemGrid'
import { CartPanel } from './components/CartPanel'
import { HeldOrdersPanel } from './components/HeldOrdersPanel'
import { OpeningCashModal, CloseShiftModal } from './modals/ShiftModals'
import { CheckoutModal } from './modals/CheckoutModal'
import { usePosStore, type HeldOrder, type LocalCartLine } from './pos-store'

export interface PendingCartSelection {
  item: MenuItem
  quantity: number
  unitPrice: number
  size?: MenuItemSizeOption
  anchor: DOMRect
}

const ALL_CATEGORY_ID = '__all__'



// ── Confirm dine-in occupied table modal ──────────────────────────────────

function OccupiedTableModal({
  tableNameAr,
  order,
  onConfirm,
  onCancel
}: {
  tableNameAr: string
  order?: Order
  onConfirm: () => void
  onCancel: () => void
}): React.ReactElement {
  return (
    <ConfirmDialog
      open
      onCancel={onCancel}
      onConfirm={onConfirm}
      title="الترابيزة مشغولة"
      message={`الترابيزة ${tableNameAr} عليها طلب مفتوح${order ? ` #${orderReference(order)}` : ''}. سيتم إضافة الأصناف الحالية إلى نفس الطلب بدل إنشاء طلب جديد.`}
      confirmLabel="إضافة على الطلب المفتوح"
      cancelLabel="إلغاء"
    />
  )
}

// ── REQ-3: Held order type (module-scope so no hoisting issues) ──────────

// ── Main POS page ─────────────────────────────────────────────────────────

export function PosPage(): React.ReactElement {
  const user = useAuthStore((s) => s.user)!

  // Menu data
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [addons, setAddons] = useState<ItemAddon[]>([])
  const [unavailableItems, setUnavailableItems] = useState<Map<string, string>>(new Map())
  const [unavailableAddons, setUnavailableAddons] = useState<Map<string, string>>(new Map())
  const [lowStockItems, setLowStockItems] = useState<Set<string>>(new Set())
  const [lowStockAddons, setLowStockAddons] = useState<Set<string>>(new Set())
  const [posLogoUrl, setPosLogoUrl] = useState('/image.png')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Pos Store
  const {
    cart, setCart,
    orderType, setOrderType,
    orderNote, setOrderNote,
    selectedTableId, setSelectedTableId,
    customerName, setCustomerName,
    customerPhone, setCustomerPhone,
    customerAddress, setCustomerAddress,
    contactId, setContactId,
    deliveryFee, setDeliveryFee,
    discountType, setDiscountType,
    discountValue, setDiscountValue,
    heldOrders,
    holdCurrentOrder,
    resumeHeldOrder,
    discardHeldOrder,
    resetCheckoutFields
  } = usePosStore()

  // Tables
  const [tables, setTables] = useState<DiningTable[]>([])
  const [unpaidOrders, setUnpaidOrders] = useState<Order[]>([])
  const [deliveryContacts, setDeliveryContacts] = useState<DeliveryContact[]>([])
  const [contactSearch, setContactSearch] = useState('')
  const [tablePopupOpen, setTablePopupOpen] = useState(false)

  // Item popups
  const [weightPopup, setWeightPopup] = useState<{ item: MenuItem; rect: DOMRect } | null>(null)
  const [sizePopup, setSizePopup] = useState<{ item: MenuItem; rect: DOMRect } | null>(null)
  const [addonPopup, setAddonPopup] = useState<PendingCartSelection | null>(null)

  // UI state
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [currentShift, setCurrentShift] = useState<Shift | null>(null)

  useEffect(() => {
    function handlePosNotification(event: Event): void {
      const detail = (event as CustomEvent<{ message?: string; restoreFocus?: boolean }>).detail
      if (detail?.message) setMessage(detail.message)
      if (detail?.restoreFocus) {
        window.setTimeout(() => {
          window.focus()
          searchInputRef.current?.focus()
        }, 0)
      }
    }
    window.addEventListener('pos:notification', handlePosNotification)
    return () => window.removeEventListener('pos:notification', handlePosNotification)
  }, [])

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
  const [posSettings, setPosSettings] = useState<AppSettings | null>(null)
  const [roundingAccess, setRoundingAccess] = useState<CashRoundingAccess>({
    enabled: false,
    allowed: false,
    maxDifference: 0,
    increment: 1
  })
  const [roundedTotal, setRoundedTotal] = useState('')
  const [roundingReason, setRoundingReason] = useState('')

  // ── REQ-3: Hold / Park orders ────────────────────────────────────────
  const [heldPanelOpen, setHeldPanelOpen] = useState(false)

  // Pending action to run after the cashier confirms opening cash
  const [openingCashModal, setOpeningCashModal] = useState(false)
  const [pendingCheckoutAfterShift, setPendingCheckoutAfterShift] = useState<null | (() => Promise<void>)>(null)

  // ── REQ-13: Close shift modal ─────────────────────────────────────────
  const [closeShiftModal, setCloseShiftModal] = useState(false)
  const [closeShiftPreview, setCloseShiftPreview] = useState<ShiftClosurePreview | null>(null)
  const [performanceTrackingEnabled, setPerformanceTrackingEnabled] = useState(false)

  // Occupied table confirmation modal
  const [occupiedTableModal, setOccupiedTableModal] = useState(false)
  const [pendingOccupiedTable, setPendingOccupiedTable] = useState<DiningTable | null>(null)
  const [pendingOccupiedOrder, setPendingOccupiedOrder] = useState<Order | null>(null)

  // ── Load menu & tables ────────────────────────────────────────────────

  const load = useCallback(async () => {
    const [cats, menu, itemAddons, stocks, diningTables, unpaid, settings, access, contacts, openShift] = await Promise.all([
      listCategories(),
      listMenuItems(true),
      listAddons(),
      getIngredientStocks(),
      listDiningTables(),
      listUnpaidDineInOrders(),
      getSettings(),
      getCashRoundingAccess(user),
      listDeliveryContacts(),
      getOpenShiftForCashier(user.id)
    ])
    setCategories(cats.filter((c) => c.active))
    setItems(menu)
    setAddons(itemAddons.filter((addon) => addon.active))
    setTables(diningTables)
    setUnpaidOrders(unpaid)
    setDeliveryContacts(contacts)
    setPosLogoUrl(settings.receiptLogoDataUrl || settings.receiptLogoProcessedDataUrl || '/image.png')
    setPosSettings(settings)
    setMaxDiscountPct(settings.maxCashierDiscountPct)
    setRoundingAccess(access)
    setCurrentShift(openShift)
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
    const unavailableAddonMap = new Map<string, string>()
    const lowAddonSet = new Set<string>()
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
    for (const addon of itemAddons) {
      if (!addon.active || !addon.linkedIngredientId) continue
      const linkedStock = stockByIngredientId.get(addon.linkedIngredientId)
      if (!linkedStock) continue
      if (linkedStock.quantity <= 0) unavailableAddonMap.set(addon.id, linkedStock.nameAr)
      else if (
        linkedStock.lowStockThreshold != null &&
        linkedStock.quantity <= linkedStock.lowStockThreshold
      ) {
        lowAddonSet.add(addon.id)
      }
    }
    setUnavailableItems(unavailable)
    setLowStockItems(lowItems)
    setUnavailableAddons(unavailableAddonMap)
    setLowStockAddons(lowAddonSet)
  }, [user])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    setSelectedCategory((current) => {
      if (!current) return current
      if (current === ALL_CATEGORY_ID) return current
      return categories.some((category) => category.id === current) ? current : null
    })
  }, [categories])

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
    if (selectedCategory && selectedCategory !== ALL_CATEGORY_ID) {
      const visibleIds = new Set<string>([selectedCategory])
      const collectChildren = (categoryId: string): void => {
        for (const child of categoryChildren.get(categoryId) ?? []) {
          visibleIds.add(child.id)
          collectChildren(child.id)
        }
      }
      collectChildren(selectedCategory)
      list = list.filter((item) => visibleIds.has(item.categoryId))
    } else if (!search.trim() && selectedCategory !== ALL_CATEGORY_ID) {
      return []
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((item) => item.nameAr.toLowerCase().includes(q))
    }
    return list
  }, [categoryChildren, items, selectedCategory, search])

  const filteredAddons = useMemo(() => {
    let list = addons
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((addon) => addon.nameAr.toLowerCase().includes(q))
    }
    return list
  }, [addons, search])

  const subtotal = orderSubtotal(cart)
  const discountsEnabled = posSettings?.discountsEnabled !== false
  const discountAmt = discountsEnabled
    ? computeDiscount(
      subtotal,
      discountValue ? discountType : undefined,
      discountValue ? Number(discountValue) : undefined
    )
    : 0
  const effectiveTax = effectiveTaxRate(
    posSettings?.taxRate,
    orderType,
    posSettings?.taxApplicationMode,
    posSettings?.taxOrderTypes
  )
  const taxAmt = computeTax(subtotal - discountAmt, effectiveTax)
  const effectiveService = effectiveServiceRate(
    posSettings?.serviceRate,
    orderType,
    posSettings?.serviceApplicationMode,
    posSettings?.serviceOrderTypes
  )
  const serviceAmt = computeService(subtotal - discountAmt, effectiveService)
  const deliveryFeeNum = orderType === 'delivery' ? (Number(deliveryFee) || 0) : 0
  const total = orderTotal(subtotal, discountAmt, taxAmt, deliveryFeeNum, serviceAmt)
  const automaticRounding = orderType === 'takeaway' && checkoutMethod === 'cash'
    ? calculateAutomaticCashRounding(total, roundingAccess)
    : null
  const roundedTotalNum = automaticRounding?.finalAmount ?? total
  const roundingDifference = automaticRounding?.differenceAmount ?? 0
  const roundingApplied = automaticRounding != null
  const roundingDisplay = roundingDifference > 0
    ? `- ${roundingDifference.toFixed(2)}`
    : `+ ${Math.abs(roundingDifference).toFixed(2)}`
  const roundingInvalid = false
  const checkoutTotal = roundingApplied ? roundedTotalNum : total

  // REQ-1: change due when cash payment
  const cashReceivedNum = Number(cashReceived) || 0
  const changeDue = checkoutMethod === 'cash' ? Math.max(0, cashReceivedNum - checkoutTotal) : 0
  const cashInsufficient = checkoutMethod === 'cash' && cashReceived.trim() !== '' && cashReceivedNum < checkoutTotal

  // REQ-6: discount over-limit check
  const configuredDiscountLimitPct = maxDiscountPct == null ? undefined : Number(maxDiscountPct)
  const discountLimitPct = configuredDiscountLimitPct != null && Number.isFinite(configuredDiscountLimitPct)
    ? Math.max(0, configuredDiscountLimitPct)
    : undefined
  const isDiscountLimited = discountsEnabled && user.role !== 'manager' && discountLimitPct != null && discountLimitPct < 100
  const appliedDiscountPct = discountType === 'percent'
    ? Number(discountValue) || 0
    : subtotal > 0 ? (discountAmt / subtotal) * 100 : 0
  const discountOverLimit = isDiscountLimited && appliedDiscountPct > (discountLimitPct ?? 100)

  const occupiedTableIds = useMemo(
    () => new Set(unpaidOrders.map((o) => o.tableId).filter(Boolean) as string[]),
    [unpaidOrders]
  )
  const selectedTable = useMemo(
    () => tables.find((t) => t.id === selectedTableId),
    [tables, selectedTableId]
  )
  const contactSearchResults = useMemo(() => {
    const query = contactSearch.trim()
    const selected = contactId ? deliveryContacts.find((contact) => contact.id === contactId) : undefined
    if (!query) {
      const base = deliveryContacts.slice(0, 8)
      return selected && !base.some((contact) => contact.id === selected.id) ? [selected, ...base.slice(0, 7)] : base
    }
    const normalized = normalizePhone(query)
    const lower = query.toLowerCase()
    const matches = deliveryContacts
      .filter((contact) =>
        (normalized && contact.normalizedPhone.includes(normalized)) ||
        contact.name.toLowerCase().includes(lower)
      )
      .slice(0, 8)
    return selected && !matches.some((contact) => contact.id === selected.id) ? [selected, ...matches.slice(0, 7)] : matches
  }, [contactId, contactSearch, deliveryContacts])
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
      menuItemId: `${item.id}:attachment:${att.masterAddonId ?? att.id}`,
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

  function addAddonToCart(addon: ItemAddon): void {
    if (unavailableAddons.has(addon.id)) return
    const key = `addon:${addon.id}`
    const line: LocalCartLine = {
      key,
      menuItemId: key,
      nameAr: addon.nameAr,
      unitPrice: addon.defaultPrice,
      quantity: 1
    }

    setCart((prev) => {
      const existing = prev.find((cartLine) => cartLine.key === key)
      if (existing) {
        return prev.map((cartLine) => (
          cartLine.key === key
            ? { ...cartLine, quantity: cartLine.quantity + 1 }
            : cartLine
        ))
      }
      return [...prev, line]
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

  function selectDeliveryContact(contact: DeliveryContact): void {
    setContactId(contact.id)
    setCustomerName(contact.name)
    setCustomerPhone(contact.phone)
    setCustomerAddress(contact.address ?? '')
    setContactSearch(`${contact.name} - ${contact.phone}`)
  }

  async function createContactFromCheckout(form: {
    name: string
    phone: string
    address?: string
    notes?: string
  }): Promise<DeliveryContact> {
    const contact = await createDeliveryContact(form, user)
    setDeliveryContacts(await listDeliveryContacts())
    selectDeliveryContact(contact)
    return contact
  }


  function handleHoldOrder(): void {
    const label = `${orderType === 'dine_in' ? `صالة ${selectedTable?.nameAr ?? ''}` : orderType === 'delivery' ? `دليفري ${customerName}` : 'تيك أواي'} — ${cart.length} صنف`
    const res = holdCurrentOrder(label)
    if (res.message) setMessage(res.message)
  }

  function handleResumeHeldOrder(held: HeldOrder): void {
    const currentLabel = `${orderType === 'dine_in' ? `صالة ${selectedTable?.nameAr ?? ''}` : orderType === 'delivery' ? `دليفري ${customerName}` : 'تيك أواي'} — ${cart.length} صنف`
    const res = resumeHeldOrder(held, currentLabel)
    if (res.message) setMessage(res.message)
    if (held.contactId) {
      const contact = deliveryContacts.find((entry) => entry.id === held.contactId)
      setContactSearch(contact ? `${contact.name} - ${contact.phone}` : held.customerPhone)
    } else {
      setContactSearch('')
    }
    setHeldPanelOpen(false)
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
    const shift = await ensureOpenShift({
      cashierId: user.id,
      cashierName: user.displayName,
      cashierCode: user.cashierCode,
      openingCash: amount
    })
    setCurrentShift(shift)
    // Now run the pending checkout action
    if (pendingCheckoutAfterShift) {
      const fn = pendingCheckoutAfterShift
      setPendingCheckoutAfterShift(null)
      await fn()
    } else {
      setMessage('تم بدء الشيفت')
    }
  }

  // ── Checkout for takeaway / delivery ─────────────────────────────────

  function printKitchenAfterSave(order: Order, orderItems: Awaited<ReturnType<typeof getOrderItems>>, settings: Awaited<ReturnType<typeof getSettings>>, successPrefix: string): void {
    printKitchenTickets(order, orderItems, settings).then((result) => {
      if (!result.ok) {
        setMessage(`${successPrefix}، لكن فشلت طباعة التجهيز: ${result.failed.map((f) => `${f.printerName}: ${f.error}`).join('، ')}`)
      }
    }).catch(() => {})
  }

  async function submitCheckout(): Promise<void> {
    if (cart.length === 0) return

    if (!discountsEnabled && discountValue) {
      setMessage('الخصومات غير مفعلة من إعدادات المدير')
      return
    }

    // REQ-6: enforce discount limit for cashiers
    if (discountOverLimit) {
      setMessage(`الخصم يتجاوز الحد المسموح (${discountLimitPct}%)`)
      return
    }

    // REQ-1 validation: cash received must cover the total
    if (checkoutMethod === 'cash') {
      if (cashReceived.trim() !== '' && cashReceivedNum < checkoutTotal) {
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
        cashReceived: checkoutMethod === 'cash'
          ? (cashReceived.trim() ? cashReceivedNum : checkoutTotal)
          : undefined,
        discountType: discountsEnabled && discountValue ? discountType : undefined,
        discountValue: discountsEnabled && discountValue ? Number(discountValue) : undefined,
        deliveryFee: orderType === 'delivery' ? Number(deliveryFee) || 0 : undefined,
        contactId: orderType === 'delivery' ? contactId : undefined,
        customerName: customerName || undefined,
        customerPhone: customerPhone || undefined,
        customerAddress: customerAddress || undefined,
        roundedTotal: orderType === 'takeaway' && roundingApplied ? roundedTotalNum : undefined,
        roundingReason: orderType === 'takeaway' && roundingApplied ? 'تقريب نقدي تلقائي' : undefined
      })
      const [orderItems, settings] = await Promise.all([getOrderItems(order.id), getSettings()])
      setCart([])
      setOrderNote('')
      setCheckoutOpen(false)
      resetCheckoutFields()
      setContactSearch('')
      setMessage(`تم إتمام الطلب #${orderReference(order)}`)
      printReceipt(order, orderItems, settings).catch(() => {})
      printKitchenAfterSave(order, orderItems, settings, 'تم حفظ الطلب')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'فشل')
    } finally {
      setLoading(false)
    }
  }

  async function submitDeliveryUnpaid(): Promise<void> {
    if (cart.length === 0 || orderType !== 'delivery') return

    if (!discountsEnabled && discountValue) {
      setMessage('الخصومات غير مفعلة من إعدادات المدير')
      return
    }

    if (discountOverLimit) {
      setMessage(`الخصم يتجاوز الحد المسموح (${discountLimitPct}%)`)
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
        orderType: 'delivery',
        discountType: discountsEnabled && discountValue ? discountType : undefined,
        discountValue: discountsEnabled && discountValue ? Number(discountValue) : undefined,
        deliveryFee: Number(deliveryFee) || 0,
        contactId,
        customerName: customerName || undefined,
        customerPhone: customerPhone || undefined,
        customerAddress: customerAddress || undefined
      })
      const [orderItems, settings] = await Promise.all([getOrderItems(order.id), getSettings()])
      setCart([])
      setOrderNote('')
      setCheckoutOpen(false)
      resetCheckoutFields()
      setContactSearch('')
      setMessage(`تم إنشاء طلب دليفري غير مدفوع #${orderReference(order)}`)
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
      printKitchenAfterSave(order, orderItems, settings, 'تم حفظ الطلب')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'فشل')
    } finally {
      setLoading(false)
    }
  }

  async function appendToDineInOrder(order: Order): Promise<void> {
    setLoading(true)
    setMessage('')
    try {
      const existingItems = await getOrderItems(order.id)
      const lines: CartLine[] = [
        ...existingItems.map((item) => ({
          menuItemId: item.menuItemId,
          nameAr: item.nameAr,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          sizeLabelAr: item.sizeLabelAr,
          attachmentForMenuItemId: item.attachmentForMenuItemId,
          unitLabel: item.unitLabel,
          weightGrams: item.weightGrams,
          noteAr: item.noteAr
        })),
        ...cart
      ]
      const updatedOrder = await editOrderItems({
        orderId: order.id,
        cashierId: user.id,
        lines,
        orderNoteAr: orderNote || order.noteAr
      })
      const [orderItems, settings, unpaid] = await Promise.all([
        getOrderItems(updatedOrder.id),
        getSettings(),
        listUnpaidDineInOrders()
      ])
      setCart([])
      setOrderNote('')
      setUnpaidOrders(unpaid)
      setMessage(`تمت إضافة الأصناف إلى طلب الصالة #${orderReference(updatedOrder)}`)
      printKitchenAfterSave(updatedOrder, orderItems, settings, 'تم تحديث طلب الصالة')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'فشل إضافة الأصناف للطلب')
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
        setPendingOccupiedOrder(unpaidOrders.find((order) => order.tableId === selectedTable.id) ?? null)
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
      void Promise.all([getSettings(), getCashRoundingAccess(user)]).then(([settings, access]) => {
        setMaxDiscountPct(settings.maxCashierDiscountPct)
        setPosSettings(settings)
        setRoundingAccess(access)
      })
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
    setCurrentShift(shift)
    if (!shift) {
      setPendingCheckoutAfterShift(null)
      setOpeningCashModal(true)
      return
    }
    const [preview, settings] = await Promise.all([getShiftClosurePreview(shift), getSettings()])
    setCloseShiftPreview(preview)
    setPerformanceTrackingEnabled(settings.employeePerformanceTrackingEnabled === true)
    setCloseShiftModal(true)
  }

  async function confirmCloseShift(closingCash: number | undefined, differenceReason?: string, overrideReason?: string): Promise<void> {
    const shift = await getOpenShiftForCashier(user.id)
    if (!shift) return
    try {
      await closeShift(shift.id, user.id, closingCash, { differenceReason, overrideReason })
      setCurrentShift(null)
      setCloseShiftModal(false)
      setCloseShiftPreview(null)
      setMessage('تمت تسوية وإغلاق الشيفت')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'تعذر إغلاق الشيفت')
    }
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
      {closeShiftModal && closeShiftPreview && (
        <CloseShiftModal
          preview={closeShiftPreview}
          performanceEnabled={performanceTrackingEnabled}
          userRole={user.role}
          onConfirm={(cash, reason, overrideReason) => void confirmCloseShift(cash, reason, overrideReason)}
          onCancel={() => { setCloseShiftModal(false); setCloseShiftPreview(null) }}
        />
      )}

      {/* ── Occupied table confirmation modal ── */}
      {occupiedTableModal && pendingOccupiedTable && (
        <OccupiedTableModal
          tableNameAr={pendingOccupiedTable.nameAr}
          order={pendingOccupiedOrder ?? undefined}
          onConfirm={async () => {
            const order = pendingOccupiedOrder
            setOccupiedTableModal(false)
            setPendingOccupiedTable(null)
            setPendingOccupiedOrder(null)
            if (!order) {
              setMessage('لم يتم العثور على الطلب المفتوح لهذه الترابيزة')
              return
            }
            const action = async (): Promise<void> => appendToDineInOrder(order)
            const ready = await ensureShiftOrPrompt(action)
            if (ready) await action()
          }}
          onCancel={() => {
            setOccupiedTableModal(false)
            setPendingOccupiedTable(null)
            setPendingOccupiedOrder(null)
          }}
        />
      )}

      {/* ── Menu panel ── */}
      <section className="pos-menu">
        <input
          ref={searchInputRef}
          className="pos-search"
          placeholder="بحث في القائمة..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <CategoryBrowser
          categories={categories}
          categoryChildren={categoryChildren}
          items={items}
          selectedCategory={selectedCategory}
          allCategoryId={ALL_CATEGORY_ID}
          onSelectCategory={setSelectedCategory}
        />

        {(selectedCategory || search.trim()) && (
          <>
            <ItemGrid
              items={filteredItems}
              unavailableItems={unavailableItems}
              lowStockItems={lowStockItems}
              onItemClick={(item, rect, isUnavailable, hasSizes) => {
                if (isUnavailable) return
                if (item.isWeighted) setWeightPopup({ item, rect })
                else if (hasSizes) setSizePopup({ item, rect })
                else openAddonsOrAddToCart({ item, quantity: 1, unitPrice: item.price, anchor: rect })
              }}
            />
            {filteredAddons.length > 0 && (
              <section className="pos-addon-section" aria-label="الإضافات">
                <div className="pos-addon-section__header">
                  <h3>الإضافات</h3>
                  <span>{filteredAddons.length} إضافة</span>
                </div>
                <div className="pos-addon-grid">
                  {filteredAddons.map((addon) => {
                    const outReason = unavailableAddons.get(addon.id)
                    const isUnavailable = !!outReason
                    const isLow = !isUnavailable && lowStockAddons.has(addon.id)
                    return (
                      <button
                        key={addon.id}
                        type="button"
                        className={`pos-addon-btn${isUnavailable ? ' pos-addon-btn--unavailable' : ''}${isLow ? ' pos-addon-btn--low' : ''}`}
                        disabled={isUnavailable}
                        onClick={() => addAddonToCart(addon)}
                      >
                        <span>{addon.nameAr}</span>
                        <strong>{addon.defaultPrice.toFixed(2)}</strong>
                        {isLow && <em>قرب النفاد</em>}
                        {isUnavailable && <em>نفذ: {outReason}</em>}
                      </button>
                    )
                  })}
                </div>
              </section>
            )}
          </>
        )}
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
      <CartPanel
        posLogoUrl={posLogoUrl}
        tables={tables}
        occupiedTableIds={occupiedTableIds}
        selectedTable={selectedTable}
        setTablePopupOpen={setTablePopupOpen}
        hasOpenShift={!!currentShift}
        handleCloseShift={() => void handleCloseShift()}
        changeQty={changeQty}
        discountAmt={discountAmt}
        subtotal={subtotal}
        deliveryFeeNum={deliveryFeeNum}
        total={total}
        message={message}
        editingOrder={editingOrder}
        setEditingOrder={setEditingOrder}
        loading={loading}
        submitEditOrder={() => void submitEditOrder()}
        handleHoldOrder={handleHoldOrder}
        handleCheckout={(method) => void handleCheckout(method)}
        setCheckoutMethod={setCheckoutMethod}
        setHeldPanelOpen={setHeldPanelOpen}
      />

      {checkoutOpen && (
        <CheckoutModal
          orderType={orderType}
          checkoutMethod={checkoutMethod}
          setCheckoutMethod={setCheckoutMethod}
          cashReceived={cashReceived}
          setCashReceived={setCashReceived}
          splitCash={splitCash}
          setSplitCash={setSplitCash}
          splitCard={splitCard}
          setSplitCard={setSplitCard}
          roundingAccess={roundingAccess}
          roundedTotal={roundedTotal}
          setRoundedTotal={setRoundedTotal}
          roundingReason={roundingReason}
          setRoundingReason={setRoundingReason}
          roundingApplied={roundingApplied}
          roundingInvalid={roundingInvalid}
          roundingDifference={roundingDifference}
          total={total}
          checkoutTotal={checkoutTotal}
          cashInsufficient={cashInsufficient}
          changeDue={changeDue}
          discountType={discountType}
          setDiscountType={setDiscountType}
          discountValue={discountValue}
          setDiscountValue={setDiscountValue}
          discountsEnabled={discountsEnabled}
          discountOverLimit={discountOverLimit}
          maxDiscountPct={discountLimitPct}
          deliveryContacts={contactSearchResults}
          contactSearch={contactSearch}
          setContactSearch={setContactSearch}
          selectedContactId={contactId}
          onSelectContact={selectDeliveryContact}
          onClearContact={() => setContactId(undefined)}
          onCreateContact={createContactFromCheckout}
          customerName={customerName}
          customerPhone={customerPhone}
          customerAddress={customerAddress}
          deliveryFee={deliveryFee}
          setDeliveryFee={setDeliveryFee}
          subtotal={subtotal}
          discountAmt={discountAmt}
          deliveryFeeNum={deliveryFeeNum}
          taxAmt={taxAmt}
          serviceAmt={serviceAmt}
          message={message}
          loading={loading}
          onSubmit={() => void submitCheckout()}
          onSubmitUnpaid={orderType === 'delivery' ? () => void submitDeliveryUnpaid() : undefined}
          onClose={() => setCheckoutOpen(false)}
        />
      )}

      {/* ── Checkout Modal ── */}
      {false && checkoutOpen && (
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
                      onClick={() => {
                        setCheckoutMethod(m)
                        setCashReceived('')
                        if (m !== 'cash') {
                          setRoundedTotal('')
                          setRoundingReason('')
                        }
                      }}
                    >
                      {m === 'cash' ? 'نقدي' : m === 'card' ? 'بطاقة' : 'تقسيم'}
                    </button>
                  ))}
                </div>

                {/* REQ-1: Cash received + change calculator */}
                {checkoutMethod === 'cash' && (
                  <div style={{ marginTop: 10 }}>
                    {roundingAccess.enabled && (
                      <div style={{ border: '1.5px solid var(--color-border-light)', borderRadius: 4, padding: 10, marginBottom: 10 }}>
                        <div style={{ fontWeight: 800, marginBottom: 6 }}>تقريب الدفع النقدي</div>
                        {roundingAccess.allowed ? (
                          <div className="settings-form-grid">
                            <label className="field">
                              <span>الإجمالي بعد التقريب</span>
                              <input
                                type="number"
                                min="0"
                                max={total}
                                step="0.01"
                                value={roundedTotal}
                                onChange={(event) => setRoundedTotal(event.target.value)}
                                placeholder={total.toFixed(2)}
                              />
                            </label>
                            <label className="field">
                              <span>السبب</span>
                              <input
                                value={roundingReason}
                                onChange={(event) => setRoundingReason(event.target.value)}
                                disabled={!roundingApplied}
                                placeholder="مثال: تسوية فكة"
                              />
                            </label>
                            <div className="settings-form-grid__full" style={{ fontSize: '0.82rem', color: roundingInvalid ? 'var(--color-danger)' : 'var(--color-muted)' }}>
                              الحد المسموح: {roundingAccess.maxDifference.toFixed(2)}
                              {roundingApplied && ` — الفرق: ${roundingDisplay}`}
                            </div>
                          </div>
                        ) : (
                          <p className="modal-hint m-0">{roundingAccess.reason}</p>
                        )}
                      </div>
                    )}
                    <label className="field m-0">
                      <span>المبلغ المستلم من العميل</span>
                      <input
                        type="number"
                        min={checkoutTotal}
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
              <div className="flex gap-8">
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
                  ⚠️ الخصم يتجاوز الحد المسموح به ({discountLimitPct}%).
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
              {taxAmt > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span>الضريبة</span><span>{taxAmt.toFixed(2)}</span>
                </div>
              )}
              {serviceAmt > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span>الخدمة</span><span>{serviceAmt.toFixed(2)}</span>
                </div>
              )}
              {roundingApplied && !roundingInvalid && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--color-danger)' }}>
                  <span>تسوية تقريب نقدي</span><span>{roundingDisplay}</span>
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
                <span>{checkoutTotal.toFixed(2)}</span>
              </div>
            </div>

            {message && <p className="form-error">{message}</p>}

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={loading || cashInsufficient || discountOverLimit || roundingInvalid}
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
        <HeldOrdersPanel
          heldOrders={heldOrders}
          onResume={handleResumeHeldOrder}
          onDiscard={discardHeldOrder}
          onClose={() => setHeldPanelOpen(false)}
        />
      )}
      {false && heldPanelOpen && (
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
                      onClick={() => handleResumeHeldOrder(held)}
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
