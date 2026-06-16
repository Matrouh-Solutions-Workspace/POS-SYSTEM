export type InventoryTransactionType =
  | 'purchase'
  | 'sale'
  | 'waste'
  | 'sale_reversal'
  | 'adjustment'

export interface Ingredient {
  id: string
  nameAr: string
  unit: string
  lowStockThreshold?: number
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface InventoryTransaction {
  id: string
  ingredientId: string
  /** Original order item that produced this stock movement, when applicable */
  orderItemId?: string
  /** Original sellable menu item that produced this stock movement, when applicable */
  menuItemId?: string
  ingredientNameAr?: string
  type: InventoryTransactionType
  /** Signed quantity in base unit (positive = in, negative = out) */
  quantity: number
  unit: string
  referenceType?: 'order' | 'purchase' | 'manual' | 'shift' | 'supplier'
  referenceId?: string
  shiftId?: string
  supplierId?: string
  noteAr?: string
  createdBy: string
  createdAt: number
}

export interface IngredientStock {
  ingredientId: string
  nameAr: string
  unit: string
  quantity: number
  lowStockThreshold?: number
}

export type CashDrawerTransactionType =
  | 'sale'
  | 'expense'
  | 'supplier_payment'
  | 'purchase_payment'
  | 'cash_in'
  | 'cash_out'

export interface CashDrawerTransaction {
  id: string
  type: CashDrawerTransactionType
  amount: number
  shiftId?: string
  orderId?: string
  supplierId?: string
  noteAr?: string
  createdBy: string
  createdAt: number
}
