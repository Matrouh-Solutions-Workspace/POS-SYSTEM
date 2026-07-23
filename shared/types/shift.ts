export type ShiftStatus = 'open' | 'closed'
export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Reusable employee schedule definition, separate from the financial POS session. */
export interface EmployeeWorkShift {
  id: string
  name: string
  startTime: string
  endTime: string
  workingDays: WeekDay[]
  overtimeEnabled: boolean
  maxOvertimeMinutes: number
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface UserShiftAssignment {
  id: string
  userId: string
  workShiftId: string
  startDate: string
  endDate?: string
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface OvertimeRecord {
  id: string
  userId: string
  workShiftId: string
  shiftSessionId: string
  startedAt: number
  endedAt: number
  durationMinutes: number
  createdAt: number
}

export interface ShiftAccessResult {
  allowed: boolean
  reason?: string
  workShift?: EmployeeWorkShift
  assignment?: UserShiftAssignment
  scheduledStartAt?: number
  scheduledEndAt?: number
  overtimeStartedAt?: number
}

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
  workShiftId?: string
  workShiftName?: string
  assignmentId?: string
  scheduledStartAt?: number
  scheduledEndAt?: number
  overtimeStartedAt?: number
  overtimeMinutes?: number
  totalSales?: number
  transactionCount?: number
  expectedCash?: number
  cashDifference?: number
  createdAt: number
  updatedAt: number
}
