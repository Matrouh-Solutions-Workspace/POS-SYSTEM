export type ShiftStatus = 'open' | 'closed'

export interface Shift {
  id: string
  cashierId: string
  cashierName: string
  cashierCode?: string
  status: ShiftStatus
  archived?: boolean
  /** Opening cash entered by cashier when starting the shift */
  openingCash?: number
  openedAt: number
  closedAt?: number
  closedBy?: string
  /** Actual cash counted at shift close */
  closingCash?: number
  createdAt: number
  updatedAt: number
}
