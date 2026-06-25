import type {
  AppSettings,
  AppUser,
  CashRoundingTransaction,
  Shift
} from '@shared/types'
import { COLLECTIONS, SETTINGS_DOC_ID } from '@shared/constants/collections'
import { getCachedDoc, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'

export interface CashRoundingAccess {
  enabled: boolean
  allowed: boolean
  maxDifference: number
  reason?: string
}

export async function getCashRoundingAccess(user: AppUser): Promise<CashRoundingAccess> {
  const settings = await getCachedDoc<AppSettings>(COLLECTIONS.settings, SETTINGS_DOC_ID)
  const enabled = settings?.cashRoundingEnabled === true
  const globalMax = Math.max(0, settings?.maxCashRoundingDifference ?? 0)
  const employeeAllowed = user.role === 'manager' || user.allowCashRounding === true
  const employeeMax = user.maxCashRoundingDifference
  const maxDifference = employeeMax != null
    ? Math.min(globalMax, Math.max(0, employeeMax))
    : globalMax

  if (!enabled) return { enabled: false, allowed: false, maxDifference: 0, reason: 'تقريب الدفع النقدي غير مفعّل.' }
  if (!employeeAllowed) return { enabled: true, allowed: false, maxDifference: 0, reason: 'هذا الحساب غير مصرح له باستخدام تقريب النقدي.' }
  if (maxDifference <= 0) return { enabled: true, allowed: false, maxDifference: 0, reason: 'حد التقريب المسموح يساوي صفرًا.' }
  return { enabled: true, allowed: true, maxDifference }
}

export function validateCashRounding(
  originalAmount: number,
  finalAmount: number,
  access: CashRoundingAccess
): number {
  if (!access.allowed) throw new Error(access.reason ?? 'غير مصرح باستخدام تقريب النقدي')
  if (!Number.isFinite(finalAmount) || finalAmount < 0) throw new Error('المبلغ النهائي غير صالح')
  if (finalAmount > originalAmount) throw new Error('التقريب لا يمكنه زيادة إجمالي الطلب')
  const difference = Math.round((originalAmount - finalAmount) * 100) / 100
  if (difference <= 0) throw new Error('المبلغ المقرب يجب أن يكون أقل من الإجمالي الأصلي')
  if (difference > access.maxDifference + 0.001) {
    throw new Error(`فرق التقريب يتجاوز الحد المسموح (${access.maxDifference.toFixed(2)})`)
  }
  return difference
}

export async function listCashRoundingTransactions(filters?: {
  userId?: string
  shiftId?: string
  deviceId?: string
  from?: string
  to?: string
}): Promise<CashRoundingTransaction[]> {
  const fromAt = filters?.from ? new Date(`${filters.from}T00:00:00`).getTime() : 0
  const toAt = filters?.to ? new Date(`${filters.to}T23:59:59.999`).getTime() : Number.MAX_SAFE_INTEGER
  const records = await getCachedDocs<CashRoundingTransaction>(COLLECTIONS.cashRoundingTransactions)
  return records
    .filter((record) =>
      (!filters?.userId || record.userId === filters.userId) &&
      (!filters?.shiftId || record.shiftId === filters.shiftId) &&
      (!filters?.deviceId || record.deviceId === filters.deviceId) &&
      record.createdAt >= fromAt &&
      record.createdAt <= toAt
    )
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function listRoundingShifts(): Promise<Shift[]> {
  const records = await getCachedDocs<CashRoundingTransaction>(COLLECTIONS.cashRoundingTransactions)
  const shiftIds = new Set(records.map((record) => record.shiftId))
  const shifts = await getCachedDocs<Shift>(COLLECTIONS.shifts)
  return shifts.filter((shift) => shiftIds.has(shift.id)).sort((a, b) => b.openedAt - a.openedAt)
}
