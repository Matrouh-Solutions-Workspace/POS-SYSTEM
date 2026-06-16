export interface KitchenPrinterVisibility {
  showOrderType: boolean
  showTable: boolean
  showCashier: boolean
  showCustomer: boolean
  showOrderNote: boolean
  showItemNotes: boolean
}

export interface KitchenPrinter {
  id: string
  name: string
  deviceName: string
  description?: string
  copies: number
  active: boolean
  visibility: KitchenPrinterVisibility
  createdAt: number
  updatedAt: number
}

export interface SystemPrinter {
  name: string
  displayName: string
  description?: string
  isDefault?: boolean
  status?: number
}
