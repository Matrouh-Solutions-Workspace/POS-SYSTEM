import { create } from 'zustand'
import type { CartLine } from '@renderer/features/orders/order-service'
import type { DiscountType, OrderType } from '@shared/types'

export interface LocalCartLine extends CartLine {
  key: string
  parentKey?: string
}

export interface HeldOrder {
  id: string
  cart: LocalCartLine[]
  orderType: OrderType
  orderNote: string
  selectedTableId: string
  customerName: string
  customerPhone: string
  customerAddress: string
  contactId?: string
  deliveryFee: string
  discountType: DiscountType
  discountValue: string
  label: string
}

interface PosState {
  // Cart State
  cart: LocalCartLine[]
  orderType: OrderType
  orderNote: string

  // Checkout State
  customerName: string
  customerPhone: string
  customerAddress: string
  contactId?: string
  deliveryFee: string
  discountType: DiscountType
  discountValue: string
  selectedTableId: string

  // Held Orders State
  heldOrders: HeldOrder[]

  // Actions
  setCart: (cart: LocalCartLine[] | ((prev: LocalCartLine[]) => LocalCartLine[])) => void
  setOrderType: (type: OrderType) => void
  setOrderNote: (note: string) => void
  setSelectedTableId: (id: string | ((prev: string) => string)) => void
  setCustomerName: (name: string) => void
  setCustomerPhone: (phone: string) => void
  setCustomerAddress: (address: string) => void
  setContactId: (id?: string) => void
  setDeliveryFee: (fee: string) => void
  setDiscountType: (type: DiscountType) => void
  setDiscountValue: (value: string) => void
  setHeldOrders: (orders: HeldOrder[] | ((prev: HeldOrder[]) => HeldOrder[])) => void

  // Complex Actions
  resetCheckoutFields: () => void
  holdCurrentOrder: (label: string) => { success: boolean; message: string }
  resumeHeldOrder: (held: HeldOrder, currentLabel: string) => { success: boolean; message: string }
  discardHeldOrder: (id: string) => void
}

export const usePosStore = create<PosState>((set, get) => ({
  cart: [],
  orderType: 'takeaway',
  orderNote: '',
  customerName: '',
  customerPhone: '',
  customerAddress: '',
  contactId: undefined,
  deliveryFee: '',
  discountType: 'percent',
  discountValue: '',
  selectedTableId: '',
  heldOrders: [],

  setCart: (cartOrUpdater) => set((state) => ({
    cart: typeof cartOrUpdater === 'function' ? cartOrUpdater(state.cart) : cartOrUpdater
  })),
  setOrderType: (orderType) => set({ orderType }),
  setOrderNote: (orderNote) => set({ orderNote }),
  setSelectedTableId: (idOrUpdater) => set((state) => ({
    selectedTableId: typeof idOrUpdater === 'function' ? idOrUpdater(state.selectedTableId) : idOrUpdater
  })),
  setCustomerName: (customerName) => set({ customerName }),
  setCustomerPhone: (customerPhone) => set({ customerPhone }),
  setCustomerAddress: (customerAddress) => set({ customerAddress }),
  setContactId: (contactId) => set({ contactId }),
  setDeliveryFee: (deliveryFee) => set({ deliveryFee }),
  setDiscountType: (discountType) => set({ discountType }),
  setDiscountValue: (discountValue) => set({ discountValue }),
  setHeldOrders: (ordersOrUpdater) => set((state) => ({
    heldOrders: typeof ordersOrUpdater === 'function' ? ordersOrUpdater(state.heldOrders) : ordersOrUpdater
  })),

  resetCheckoutFields: () => set({
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    contactId: undefined,
    deliveryFee: '',
    discountValue: ''
  }),

  holdCurrentOrder: (label) => {
    const { cart, heldOrders, orderType, orderNote, selectedTableId, customerName, customerPhone, customerAddress, contactId, deliveryFee, discountType, discountValue } = get()
    if (cart.length === 0) return { success: false, message: '' }
    if (heldOrders.length >= 10) {
      return { success: false, message: 'الحد الأقصى للطلبات المعلقة هو 10' }
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
      contactId,
      deliveryFee,
      discountType,
      discountValue,
      label
    }
    
    set({
      heldOrders: [...heldOrders, held],
      cart: [],
      orderNote: ''
    })
    
    return { success: true, message: 'تم تعليق الطلب' }
  },

  resumeHeldOrder: (held, currentLabel) => {
    const { cart, holdCurrentOrder } = get()
    
    if (cart.length > 0) {
      holdCurrentOrder(currentLabel)
    }
    
    set((state) => ({
      cart: held.cart,
      orderType: held.orderType,
      orderNote: held.orderNote,
      selectedTableId: held.selectedTableId,
      customerName: held.customerName,
      customerPhone: held.customerPhone,
      customerAddress: held.customerAddress,
      contactId: held.contactId,
      deliveryFee: held.deliveryFee,
      discountType: held.discountType,
      discountValue: held.discountValue,
      heldOrders: state.heldOrders.filter((h) => h.id !== held.id)
    }))
    
    return { success: true, message: 'تم استعادة الطلب' }
  },

  discardHeldOrder: (id) => set((state) => ({
    heldOrders: state.heldOrders.filter((h) => h.id !== id)
  }))
}))
