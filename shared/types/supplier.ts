export interface Supplier {
  id: string
  nameAr: string
  phone?: string
  noteAr?: string
  active: boolean
  createdAt: number
  updatedAt: number
}

export type SupplierTransactionType =
  | 'purchase_credit'
  | 'payment'
  | 'debt_increase'
  | 'debt_decrease'
  | 'settlement'

export interface SupplierTransaction {
  id: string
  supplierId: string
  type: SupplierTransactionType
  amount: number
  paidAmount?: number
  remainingAmount?: number
  paymentMethod?: 'cash' | 'card' | 'bank' | 'other'
  paymentSource?: 'cash_drawer' | 'external'
  noteAr?: string
  shiftId?: string
  createdBy: string
  createdByName?: string
  paidBy?: string
  paidByName?: string
  createdAt: number
}
