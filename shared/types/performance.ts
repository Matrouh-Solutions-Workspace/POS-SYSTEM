import type { AuditAction } from './audit'

export interface EmployeeActivityLog {
  id: string
  userId: string
  username: string
  actionType: AuditAction
  referenceId?: string
  deviceId: string
  detailAr: string
  createdAt: number
}

export interface EmployeePerformanceDaily {
  id: string
  userId: string
  date: string
  totalSales: number
  ordersCount: number
  completedOrders: number
  cancelledOrders: number
  refundedOrders: number
  averageOrderValue: number
  averageProcessingMinutes: number
  itemsSold: number
  cashPayments: number
  cardPayments: number
  refundAmount: number
  discountAmount: number
  cashDifference: number
  workedMinutes: number
  createdAt: number
  updatedAt: number
}

export type CashDifferenceType = 'balanced' | 'shortage' | 'surplus'

export interface ShiftClosureRecord {
  id: string
  shiftSessionId: string
  userId: string
  openingCash: number
  cashSales: number
  cardSales: number
  refunds: number
  cashAdjustments: number
  expectedCash: number
  actualCash: number
  difference: number
  differenceType: CashDifferenceType
  differenceReason?: string
  approvedBy?: string
  approvedAt?: number
  ordersCount: number
  closedAt: number
  createdAt: number
  updatedAt: number
}
