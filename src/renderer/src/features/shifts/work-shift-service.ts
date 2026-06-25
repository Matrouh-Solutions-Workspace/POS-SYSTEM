import type {
  AppSettings,
  AppUser,
  EmployeeWorkShift,
  OvertimeRecord,
  Order,
  Shift,
  ShiftAccessResult,
  UserShiftAssignment,
  WeekDay
} from '@shared/types'
import { COLLECTIONS, SETTINGS_DOC_ID } from '@shared/constants/collections'
import { cacheDocs, getCachedDoc, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { dbDelete } from '@renderer/lib/db/sqlite-db'
import { generateId } from '@renderer/lib/utils/id'
import { actorAuditName, type AuditActor } from '@renderer/features/audit/audit-service'

export interface WorkShiftInput {
  name: string
  startTime: string
  endTime: string
  workingDays: WeekDay[]
  overtimeEnabled: boolean
  maxOvertimeMinutes: number
  active: boolean
}

export interface ShiftAssignmentInput {
  userId: string
  workShiftId: string
  startDate: string
  endDate?: string
  active: boolean
}

export interface ShiftAttendanceRow {
  session: Shift
  user?: AppUser
  workShift?: EmployeeWorkShift
  lateMinutes: number
  earlyLeaveMinutes: number
  overtimeMinutes: number
  workedMinutes: number
  orderCount: number
  revenue: number
  cashDifference?: number
}

const DAY_MS = 24 * 60 * 60 * 1000

function audit(
  actor: AuditActor,
  params: Parameters<typeof import('@renderer/features/audit/audit-service').logAudit>[0]
): void {
  void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
    logAudit({ ...params, actorId: actor.id, actorName: actorAuditName(actor) })
  )
}

function dateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function atTime(date: Date, value: string): Date {
  const [hours, minutes] = value.split(':').map(Number)
  const result = new Date(date)
  result.setHours(hours || 0, minutes || 0, 0, 0)
  return result
}

function scheduleWindow(workShift: EmployeeWorkShift, workDate: Date): {
  start: number
  end: number
} {
  const start = atTime(workDate, workShift.startTime)
  const end = atTime(workDate, workShift.endTime)
  if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1)
  return { start: start.getTime(), end: end.getTime() }
}

function assignmentCoversDate(assignment: UserShiftAssignment, key: string): boolean {
  return assignment.active &&
    assignment.startDate <= key &&
    (!assignment.endDate || assignment.endDate >= key)
}

function rangesOverlap(
  firstStart: string,
  firstEnd: string | undefined,
  secondStart: string,
  secondEnd: string | undefined
): boolean {
  const openEnd = '9999-12-31'
  return firstStart <= (secondEnd || openEnd) && secondStart <= (firstEnd || openEnd)
}

export async function isShiftManagementEnabled(): Promise<boolean> {
  const settings = await getCachedDoc<AppSettings>(COLLECTIONS.settings, SETTINGS_DOC_ID)
  return settings?.shiftManagementEnabled === true
}

export async function listWorkShifts(): Promise<EmployeeWorkShift[]> {
  const shifts = await getCachedDocs<EmployeeWorkShift>(COLLECTIONS.workShifts)
  return shifts.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.name.localeCompare(b.name, 'ar'))
}

export async function saveWorkShift(
  input: WorkShiftInput,
  actor: AuditActor,
  id?: string
): Promise<EmployeeWorkShift> {
  const name = input.name.trim()
  if (!name) throw new Error('اسم الوردية مطلوب')
  if (!/^\d{2}:\d{2}$/.test(input.startTime) || !/^\d{2}:\d{2}$/.test(input.endTime)) {
    throw new Error('وقت بداية ونهاية الوردية مطلوبان')
  }
  if (!input.workingDays.length) throw new Error('اختر يوم عمل واحدًا على الأقل')

  const existing = id ? await getCachedDoc<EmployeeWorkShift>(COLLECTIONS.workShifts, id) : null
  const now = Date.now()
  const workShift: EmployeeWorkShift = {
    id: existing?.id ?? generateId(),
    name,
    startTime: input.startTime,
    endTime: input.endTime,
    workingDays: [...new Set(input.workingDays)].sort() as WeekDay[],
    overtimeEnabled: input.overtimeEnabled,
    maxOvertimeMinutes: input.overtimeEnabled
      ? Math.max(0, Math.round(input.maxOvertimeMinutes))
      : 0,
    active: input.active,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
  await cacheDocs(COLLECTIONS.workShifts, [workShift])
  audit(actor, {
    action: existing ? 'work_shift_updated' : 'work_shift_created',
    actorId: actor.id,
    actorName: actorAuditName(actor),
    targetId: workShift.id,
    targetType: 'work_shift',
    detailAr: `${existing ? 'تعديل' : 'إنشاء'} وردية عمل: ${workShift.name} (${workShift.startTime} - ${workShift.endTime})`
  })
  return workShift
}

export async function deleteWorkShift(id: string, actor: AuditActor): Promise<void> {
  const workShift = await getCachedDoc<EmployeeWorkShift>(COLLECTIONS.workShifts, id)
  if (!workShift) return
  const assignments = await getCachedDocs<UserShiftAssignment>(COLLECTIONS.userShiftAssignments)
  if (assignments.some((assignment) => assignment.workShiftId === id && assignment.active)) {
    throw new Error('لا يمكن حذف وردية مرتبطة بتعيين نشط. أوقف التعيين أولًا.')
  }
  await dbDelete(COLLECTIONS.workShifts, id)
  audit(actor, {
    action: 'work_shift_deleted',
    actorId: actor.id,
    actorName: actorAuditName(actor),
    targetId: id,
    targetType: 'work_shift',
    detailAr: `حذف وردية عمل: ${workShift.name}`
  })
}

export async function listShiftAssignments(): Promise<UserShiftAssignment[]> {
  const assignments = await getCachedDocs<UserShiftAssignment>(COLLECTIONS.userShiftAssignments)
  return assignments.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveShiftAssignment(
  input: ShiftAssignmentInput,
  actor: AuditActor,
  id?: string
): Promise<UserShiftAssignment> {
  if (!input.userId || !input.workShiftId || !input.startDate) {
    throw new Error('الموظف والوردية وتاريخ البداية بيانات مطلوبة')
  }
  if (input.endDate && input.endDate < input.startDate) {
    throw new Error('تاريخ النهاية يجب ألا يسبق تاريخ البداية')
  }
  const workShift = await getCachedDoc<EmployeeWorkShift>(COLLECTIONS.workShifts, input.workShiftId)
  if (!workShift) throw new Error('وردية العمل غير موجودة')

  const assignments = await getCachedDocs<UserShiftAssignment>(COLLECTIONS.userShiftAssignments)
  const conflict = input.active && assignments.some((assignment) =>
    assignment.id !== id &&
    assignment.userId === input.userId &&
    assignment.active &&
    rangesOverlap(input.startDate, input.endDate, assignment.startDate, assignment.endDate)
  )
  if (conflict) throw new Error('يوجد تعيين نشط متداخل لهذا الموظف')

  const existing = id ? assignments.find((assignment) => assignment.id === id) : undefined
  const now = Date.now()
  const assignment: UserShiftAssignment = {
    id: existing?.id ?? generateId(),
    userId: input.userId,
    workShiftId: input.workShiftId,
    startDate: input.startDate,
    endDate: input.endDate || undefined,
    active: input.active,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
  await cacheDocs(COLLECTIONS.userShiftAssignments, [assignment])
  audit(actor, {
    action: existing ? 'shift_assignment_updated' : 'shift_assignment_created',
    actorId: actor.id,
    actorName: actorAuditName(actor),
    targetId: assignment.id,
    targetType: 'shift_assignment',
    detailAr: `${existing ? 'تعديل' : 'إنشاء'} تعيين وردية للموظف ${input.userId}: ${workShift.name}`
  })
  return assignment
}

export async function deleteShiftAssignment(id: string, actor: AuditActor): Promise<void> {
  const assignment = await getCachedDoc<UserShiftAssignment>(COLLECTIONS.userShiftAssignments, id)
  if (!assignment) return
  await dbDelete(COLLECTIONS.userShiftAssignments, id)
  audit(actor, {
    action: 'shift_assignment_deleted',
    actorId: actor.id,
    actorName: actorAuditName(actor),
    targetId: id,
    targetType: 'shift_assignment',
    detailAr: `حذف تعيين وردية للموظف ${assignment.userId}`
  })
}

export async function validateUserShiftAccess(
  userId: string,
  at = Date.now()
): Promise<ShiftAccessResult> {
  if (!(await isShiftManagementEnabled())) return { allowed: true }

  const [assignments, workShifts] = await Promise.all([
    getCachedDocs<UserShiftAssignment>(COLLECTIONS.userShiftAssignments),
    getCachedDocs<EmployeeWorkShift>(COLLECTIONS.workShifts)
  ])
  const shiftMap = new Map(workShifts.map((shift) => [shift.id, shift]))
  const now = new Date(at)
  const candidateDates = [new Date(now), new Date(now.getTime() - DAY_MS)]
  let hasCurrentAssignment = false

  for (const workDate of candidateDates) {
    workDate.setHours(0, 0, 0, 0)
    const key = dateKey(workDate)
    const matchingAssignments = assignments.filter((assignment) =>
      assignment.userId === userId && assignmentCoversDate(assignment, key)
    )
    if (matchingAssignments.length) hasCurrentAssignment = true

    for (const assignment of matchingAssignments) {
      const workShift = shiftMap.get(assignment.workShiftId)
      if (!workShift?.active || !workShift.workingDays.includes(workDate.getDay() as WeekDay)) continue
      const window = scheduleWindow(workShift, workDate)
      const allowedEnd = window.end + (workShift.overtimeEnabled ? workShift.maxOvertimeMinutes * 60_000 : 0)
      if (at >= window.start && at <= allowedEnd) {
        return {
          allowed: true,
          workShift,
          assignment,
          scheduledStartAt: window.start,
          scheduledEndAt: window.end,
          overtimeStartedAt: at > window.end ? window.end : undefined
        }
      }
    }
  }

  if (!hasCurrentAssignment) {
    return { allowed: false, reason: 'لا توجد وردية عمل مفعلة ومُعيّنة لهذا الحساب في التاريخ الحالي.' }
  }
  return { allowed: false, reason: 'تسجيل الدخول أو البيع غير متاح خارج وقت وردية العمل المسموح.' }
}

export async function saveOvertimeForClosedSession(session: Shift): Promise<OvertimeRecord | null> {
  if (!session.workShiftId || !session.scheduledEndAt || !session.closedAt) return null
  const minutes = Math.max(0, Math.ceil((session.closedAt - session.scheduledEndAt) / 60_000))
  if (!minutes) return null
  const existing = (await getCachedDocs<OvertimeRecord>(COLLECTIONS.overtimeRecords))
    .find((record) => record.shiftSessionId === session.id)
  const record: OvertimeRecord = {
    id: existing?.id ?? generateId(),
    userId: session.cashierId,
    workShiftId: session.workShiftId,
    shiftSessionId: session.id,
    startedAt: session.scheduledEndAt,
    endedAt: session.closedAt,
    durationMinutes: minutes,
    createdAt: existing?.createdAt ?? Date.now()
  }
  await cacheDocs(COLLECTIONS.overtimeRecords, [record])
  return record
}

export async function listOvertimeRecords(): Promise<OvertimeRecord[]> {
  const records = await getCachedDocs<OvertimeRecord>(COLLECTIONS.overtimeRecords)
  return records.sort((a, b) => b.startedAt - a.startedAt)
}

export async function getShiftAttendanceReport(filters?: {
  userId?: string
  workShiftId?: string
  from?: string
  to?: string
}): Promise<ShiftAttendanceRow[]> {
  const [sessions, users, workShifts, orders] = await Promise.all([
    getCachedDocs<Shift>(COLLECTIONS.shifts),
    getCachedDocs<AppUser>(COLLECTIONS.users),
    listWorkShifts(),
    getCachedDocs<Order>(COLLECTIONS.orders)
  ])
  const userMap = new Map(users.map((user) => [user.id, user]))
  const shiftMap = new Map(workShifts.map((shift) => [shift.id, shift]))
  const fromAt = filters?.from ? new Date(`${filters.from}T00:00:00`).getTime() : 0
  const toAt = filters?.to ? new Date(`${filters.to}T23:59:59.999`).getTime() : Number.MAX_SAFE_INTEGER

  return sessions
    .filter((session) =>
      (!filters?.userId || session.cashierId === filters.userId) &&
      (!filters?.workShiftId || session.workShiftId === filters.workShiftId) &&
      session.openedAt >= fromAt &&
      session.openedAt <= toAt
    )
    .sort((a, b) => b.openedAt - a.openedAt)
    .map((session) => {
      const end = session.closedAt ?? Date.now()
      const completedOrders = orders.filter((order) =>
        order.shiftId === session.id && order.status === 'completed'
      )
      return {
        session,
        user: userMap.get(session.cashierId),
        workShift: session.workShiftId ? shiftMap.get(session.workShiftId) : undefined,
        lateMinutes: session.scheduledStartAt
          ? Math.max(0, Math.floor((session.openedAt - session.scheduledStartAt) / 60_000))
          : 0,
        earlyLeaveMinutes: session.scheduledEndAt && session.closedAt
          ? Math.max(0, Math.ceil((session.scheduledEndAt - session.closedAt) / 60_000))
          : 0,
        overtimeMinutes: session.scheduledEndAt && session.closedAt
          ? Math.max(0, Math.ceil((session.closedAt - session.scheduledEndAt) / 60_000))
          : 0,
        workedMinutes: Math.max(0, Math.floor((end - session.openedAt) / 60_000)),
        orderCount: session.transactionCount ?? completedOrders.length,
        revenue: session.totalSales ?? completedOrders.reduce((sum, order) => sum + order.total, 0),
        cashDifference: session.cashDifference
      }
    })
}
