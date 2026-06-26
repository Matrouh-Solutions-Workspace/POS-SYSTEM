import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppUser, EmployeeWorkShift, UserShiftAssignment, WeekDay } from '@shared/types'
import { MdAdd, MdDelete, MdEdit } from 'react-icons/md'
import { listAllAccounts } from '@renderer/features/auth/auth-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { getSettings, updateSettings } from '@renderer/features/orders/order-service'
import { FormField, FormModal } from '@renderer/components/ui'
import {
  deleteShiftAssignment,
  deleteWorkShift,
  listShiftAssignments,
  listWorkShifts,
  saveShiftAssignment,
  saveWorkShift,
  type ShiftAssignmentInput,
  type WorkShiftInput
} from '@renderer/features/shifts/work-shift-service'

type PanelTab = 'assignments' | 'schedules'

const DAYS: Array<{ value: WeekDay; label: string }> = [
  { value: 6, label: 'السبت' },
  { value: 0, label: 'الأحد' },
  { value: 1, label: 'الاثنين' },
  { value: 2, label: 'الثلاثاء' },
  { value: 3, label: 'الأربعاء' },
  { value: 4, label: 'الخميس' },
  { value: 5, label: 'الجمعة' }
]

const EMPTY_SHIFT: WorkShiftInput = {
  name: '',
  startTime: '09:00',
  endTime: '17:00',
  workingDays: [6, 0, 1, 2, 3, 4],
  overtimeEnabled: false,
  maxOvertimeMinutes: 0,
  active: true
}

function todayKey(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function WorkShiftManagement(): React.ReactElement {
  const actor = useAuthStore((state) => state.user)!
  const [enabled, setEnabled] = useState(false)
  const [activeTab, setActiveTab] = useState<PanelTab>('assignments')
  const [workShifts, setWorkShifts] = useState<EmployeeWorkShift[]>([])
  const [assignments, setAssignments] = useState<UserShiftAssignment[]>([])
  const [cashiers, setCashiers] = useState<AppUser[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // Shift Modal State
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false)
  const [shiftForm, setShiftForm] = useState<WorkShiftInput>(EMPTY_SHIFT)
  const [editingShiftId, setEditingShiftId] = useState<string>()

  // Assignment Modal State
  const [isAssignmentModalOpen, setIsAssignmentModalOpen] = useState(false)
  const [assignmentForm, setAssignmentForm] = useState<ShiftAssignmentInput>({
    userId: '',
    workShiftId: '',
    startDate: todayKey(),
    active: true
  })
  const [editingAssignmentId, setEditingAssignmentId] = useState<string>()

  const load = useCallback(async () => {
    const [settings, shifts, savedAssignments, users] = await Promise.all([
      getSettings(),
      listWorkShifts(),
      listShiftAssignments(),
      listAllAccounts()
    ])
    setEnabled(settings.shiftManagementEnabled === true)
    setWorkShifts(shifts)
    setAssignments(savedAssignments)
    setCashiers(users.filter((user) => user.role === 'cashier' && user.active))
  }, [])

  useEffect(() => { void load() }, [load])

  const shiftMap = useMemo(
    () => new Map(workShifts.map((shift) => [shift.id, shift])),
    [workShifts]
  )
  const userMap = useMemo(
    () => new Map(cashiers.map((user) => [user.id, user])),
    [cashiers]
  )

  function clearFeedback(): void {
    setMessage('')
    setError('')
  }

  async function toggleFeature(): Promise<void> {
    clearFeedback()
    const next = !enabled
    try {
      await updateSettings({ shiftManagementEnabled: next }, actor)
      setEnabled(next)
      setMessage(next ? 'تم تفعيل إدارة ورديات الموظفين' : 'تم إيقاف القيود وعاد تسجيل الدخول للوضع المعتاد')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر حفظ الإعداد')
    }
  }

  async function submitShift(): Promise<void> {
    clearFeedback()
    try {
      await saveWorkShift(shiftForm, actor, editingShiftId)
      setShiftForm(EMPTY_SHIFT)
      setEditingShiftId(undefined)
      setIsShiftModalOpen(false)
      setMessage(editingShiftId ? 'تم تعديل الوردية' : 'تم إنشاء الوردية')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر حفظ الوردية')
      throw cause // To prevent modal from closing if we returned false in onSubmit
    }
  }

  function openShiftModal(shift?: EmployeeWorkShift): void {
    clearFeedback()
    if (shift) {
      setEditingShiftId(shift.id)
      setShiftForm({
        name: shift.name,
        startTime: shift.startTime,
        endTime: shift.endTime,
        workingDays: shift.workingDays,
        overtimeEnabled: shift.overtimeEnabled,
        maxOvertimeMinutes: shift.maxOvertimeMinutes,
        active: shift.active
      })
    } else {
      setEditingShiftId(undefined)
      setShiftForm(EMPTY_SHIFT)
    }
    setIsShiftModalOpen(true)
  }

  async function removeShift(shift: EmployeeWorkShift): Promise<void> {
    clearFeedback()
    try {
      await deleteWorkShift(shift.id, actor)
      setMessage('تم حذف الوردية')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر حذف الوردية')
    }
  }

  async function submitAssignment(): Promise<void> {
    clearFeedback()
    try {
      await saveShiftAssignment(assignmentForm, actor, editingAssignmentId)
      setAssignmentForm({ userId: '', workShiftId: '', startDate: todayKey(), active: true })
      setEditingAssignmentId(undefined)
      setIsAssignmentModalOpen(false)
      setMessage(editingAssignmentId ? 'تم تعديل التعيين' : 'تم تعيين الوردية للموظف')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر حفظ التعيين')
      throw cause
    }
  }

  function openAssignmentModal(assignment?: UserShiftAssignment): void {
    clearFeedback()
    if (assignment) {
      setEditingAssignmentId(assignment.id)
      setAssignmentForm({
        userId: assignment.userId,
        workShiftId: assignment.workShiftId,
        startDate: assignment.startDate,
        endDate: assignment.endDate,
        active: assignment.active
      })
    } else {
      setEditingAssignmentId(undefined)
      setAssignmentForm({ userId: '', workShiftId: '', startDate: todayKey(), active: true })
    }
    setIsAssignmentModalOpen(true)
  }

  async function removeAssignment(assignment: UserShiftAssignment): Promise<void> {
    clearFeedback()
    await deleteShiftAssignment(assignment.id, actor)
    setMessage('تم حذف التعيين')
    await load()
  }

  function handleTabKeys(event: React.KeyboardEvent<HTMLDivElement>): void {
    const tabs: PanelTab[] = ['assignments', 'schedules']
    const current = tabs.indexOf(activeTab)
    let next = current
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    setActiveTab(tabs[next]!)
  }

  return (
    <section className="card work-shift-card" aria-labelledby="work-shifts-title">
      <div className="shifts-card__header">
        <div>
          <span className="shifts-card__eyebrow">قواعد الدخول والبيع</span>
          <h2 id="work-shifts-title" className="card__title">إعدادات ورديات الموظفين</h2>
          <p className="modal-hint">اختار الكاشير وعدّل تعيينه بسرعة. لو محتاج تغيّر وقت الوردية افتح تبويب الورديات.</p>
        </div>
        <label className={`shift-feature-toggle ${enabled ? 'shift-feature-toggle--on' : ''}`}>
          <input type="checkbox" checked={enabled} onChange={() => void toggleFeature()} />
          <span>{enabled ? 'النظام مفعّل' : 'النظام متوقف'}</span>
        </label>
      </div>

      {message && <p className="form-message form-message--ok">{message}</p>}
      {error && <p className="form-message form-message--error">{error}</p>}

      <div className="inner-tabs shift-tabs" role="tablist" onKeyDown={handleTabKeys}>
        {([
          ['assignments', `تعيين الكاشير (${assignments.length})`],
          ['schedules', `الورديات (${workShifts.length})`]
        ] as Array<[PanelTab, string]>).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            tabIndex={activeTab === key ? 0 : -1}
            className={`inner-tabs__btn${activeTab === key ? ' inner-tabs__btn--active' : ''}`}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'schedules' && (
        <>
          <div className="page-toolbar" style={{ justifyContent: 'flex-end', marginBottom: 16 }}>
            <button className="btn btn--primary" onClick={() => openShiftModal()}><MdAdd /> إضافة وردية</button>
          </div>
          <div className="table-scroll">
            <table className="data-table shifts-table">
              <thead><tr><th>الوردية</th><th>الوقت</th><th>الأيام</th><th>الإضافي</th><th>الحالة</th><th>إجراءات</th></tr></thead>
              <tbody>
                {workShifts.length === 0 ? <tr><td colSpan={6}><div className="empty-state"><strong>لم تتم إضافة ورديات عمل بعد.</strong><span>ابدأ بتعريف وردية صباحية أو مسائية ثم عيّنها للكاشير.</span></div></td></tr> : workShifts.map((shift) => (
                  <tr key={shift.id}>
                    <td><strong>{shift.name}</strong></td>
                    <td dir="ltr">{shift.startTime} - {shift.endTime}</td>
                    <td>{DAYS.filter((day) => shift.workingDays.includes(day.value)).map((day) => day.label).join('، ')}</td>
                    <td>{shift.overtimeEnabled ? `${shift.maxOvertimeMinutes} دقيقة` : 'غير مسموح'}</td>
                    <td><span className={`status-pill ${shift.active ? 'status-pill--success' : 'status-pill--muted'}`}>{shift.active ? 'نشطة' : 'متوقفة'}</span></td>
                    <td>
                      <div className="table-actions">
                        <button className="btn btn--secondary btn--sm" type="button" onClick={() => openShiftModal(shift)}><MdEdit /> تعديل</button>
                        <button className="btn btn--danger btn--sm" type="button" onClick={() => void removeShift(shift)}><MdDelete /> حذف</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === 'assignments' && (
        <>
          <div className="page-toolbar" style={{ justifyContent: 'flex-end', marginBottom: 16 }}>
            <button className="btn btn--primary" onClick={() => openAssignmentModal()}><MdAdd /> تعيين وردية</button>
          </div>
          <div className="table-scroll">
            <table className="data-table shifts-table">
              <thead><tr><th>المستخدم</th><th>الوردية</th><th>الفترة</th><th>الحالة</th><th>إجراءات</th></tr></thead>
              <tbody>
                {assignments.length === 0 ? <tr><td colSpan={5}><div className="empty-state"><strong>لا توجد تعيينات.</strong><span>عيّن وردية لكل كاشير حتى يتم تطبيق قواعد الدخول.</span></div></td></tr> : assignments.map((assignment) => (
                  <tr key={assignment.id}>
                    <td>{userMap.get(assignment.userId)?.username ?? assignment.userId}</td>
                    <td>{shiftMap.get(assignment.workShiftId)?.name ?? 'وردية محذوفة'}</td>
                    <td dir="ltr">{assignment.startDate} → {assignment.endDate ?? 'مستمر'}</td>
                    <td><span className={`status-pill ${assignment.active ? 'status-pill--success' : 'status-pill--muted'}`}>{assignment.active ? 'نشط' : 'متوقف'}</span></td>
                    <td>
                      <div className="table-actions">
                        <button className="btn btn--secondary btn--sm" type="button" onClick={() => openAssignmentModal(assignment)}><MdEdit /> تعديل</button>
                        <button className="btn btn--danger btn--sm" type="button" onClick={() => void removeAssignment(assignment)}><MdDelete /> حذف</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {isShiftModalOpen && (
        <FormModal
          open={true}
          entityName="وردية"
          isEdit={!!editingShiftId}
          onClose={() => setIsShiftModalOpen(false)}
          onSubmit={submitShift}
        >
          <FormField label="اسم الوردية" required>
            <input value={shiftForm.name} onChange={(event) => setShiftForm({ ...shiftForm, name: event.target.value })} placeholder="مثال: الوردية الصباحية" required />
          </FormField>
          <FormField label="وقت البداية" required>
            <input type="time" value={shiftForm.startTime} onChange={(event) => setShiftForm({ ...shiftForm, startTime: event.target.value })} required />
          </FormField>
          <FormField label="وقت النهاية" required>
            <input type="time" value={shiftForm.endTime} onChange={(event) => setShiftForm({ ...shiftForm, endTime: event.target.value })} required />
          </FormField>
          <div className="field settings-form-grid__full">
            <span>أيام العمل</span>
            <div className="day-picker">
              {DAYS.map((day) => (
                <label key={day.value} className="day-picker__item">
                  <input
                    type="checkbox"
                    checked={shiftForm.workingDays.includes(day.value)}
                    onChange={(event) => setShiftForm({
                      ...shiftForm,
                      workingDays: event.target.checked
                        ? [...shiftForm.workingDays, day.value]
                        : shiftForm.workingDays.filter((value) => value !== day.value)
                    })}
                  />
                  <span>{day.label}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="field field--checkbox">
            <input type="checkbox" checked={shiftForm.overtimeEnabled} onChange={(event) => setShiftForm({ ...shiftForm, overtimeEnabled: event.target.checked })} />
            <span>السماح بالعمل الإضافي</span>
          </label>
          <FormField label="أقصى عمل إضافي بالدقائق">
            <input type="number" min="0" disabled={!shiftForm.overtimeEnabled} value={shiftForm.maxOvertimeMinutes} onChange={(event) => setShiftForm({ ...shiftForm, maxOvertimeMinutes: Number(event.target.value) })} />
          </FormField>
          <label className="field field--checkbox">
            <input type="checkbox" checked={shiftForm.active} onChange={(event) => setShiftForm({ ...shiftForm, active: event.target.checked })} />
            <span>الوردية نشطة</span>
          </label>
        </FormModal>
      )}

      {isAssignmentModalOpen && (
        <FormModal
          open={true}
          entityName="تعيين وردية"
          isEdit={!!editingAssignmentId}
          onClose={() => setIsAssignmentModalOpen(false)}
          onSubmit={submitAssignment}
        >
          <FormField label="الكاشير" required>
            <select value={assignmentForm.userId} onChange={(event) => setAssignmentForm({ ...assignmentForm, userId: event.target.value })} required>
              <option value="">اختر الحساب</option>
              {cashiers.map((user) => <option key={user.id} value={user.id}>{user.username} - {user.displayName}</option>)}
            </select>
          </FormField>
          <FormField label="الوردية" required>
            <select value={assignmentForm.workShiftId} onChange={(event) => setAssignmentForm({ ...assignmentForm, workShiftId: event.target.value })} required>
              <option value="">اختر الوردية</option>
              {workShifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}
            </select>
          </FormField>
          <FormField label="من تاريخ" required>
            <input type="date" value={assignmentForm.startDate} onChange={(event) => setAssignmentForm({ ...assignmentForm, startDate: event.target.value })} required />
          </FormField>
          <FormField label="حتى تاريخ (اختياري)">
            <input type="date" value={assignmentForm.endDate ?? ''} onChange={(event) => setAssignmentForm({ ...assignmentForm, endDate: event.target.value || undefined })} />
          </FormField>
          <label className="field field--checkbox">
            <input type="checkbox" checked={assignmentForm.active} onChange={(event) => setAssignmentForm({ ...assignmentForm, active: event.target.checked })} />
            <span>التعيين نشط</span>
          </label>
        </FormModal>
      )}
    </section>
  )
}
