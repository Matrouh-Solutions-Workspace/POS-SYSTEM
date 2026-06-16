export type OrderStatus = 'draft' | 'completed' | 'cancelled'
export type OrderType = 'takeaway' | 'dine_in' | 'delivery'
export type PaymentStatus = 'paid' | 'unpaid' | 'split'

export type DiscountType = 'percent' | 'fixed'

export interface Order {
  id: string
  orderNumber: number
  orderCode?: string
  status: OrderStatus
  orderType?: OrderType
  paymentStatus?: PaymentStatus
  tableId?: string
  tableNameAr?: string
  tableCategoryAr?: string
  shiftId?: string
  cashierId: string
  cashierName: string
  cashierCode?: string
  subtotal: number
  discountType?: DiscountType
  discountValue?: number   // percentage (0-100) or fixed amount
  discountAmount?: number  // computed discount amount stored for receipts
  taxRate?: number         // percentage e.g. 14 for 14% VAT
  taxAmount?: number       // computed tax amount stored for receipts
  deliveryFee?: number
  total: number            // subtotal - discountAmount + taxAmount + deliveryFee
  noteAr?: string
  // Delivery customer info
  customerName?: string
  customerPhone?: string
  customerAddress?: string
  archived?: boolean
  createdAt: number
  updatedAt: number
  completedAt?: number
  paidAt?: number
  cancelledAt?: number
  cancelledBy?: string
  cancelReasonAr?: string
  cancelInventoryMode?: 'return' | 'waste'
}

export interface OrderItem {
  id: string
  orderId: string
  menuItemId: string
  nameAr: string
  unitPrice: number
  quantity: number
  sizeLabelAr?: string
  attachmentForMenuItemId?: string
  unitLabel?: string
  weightGrams?: number
  lineTotal: number
  noteAr?: string
}

export interface Payment {
  id: string
  orderId: string
  amount: number
  method: 'cash' | 'card'
  createdAt: number
}
