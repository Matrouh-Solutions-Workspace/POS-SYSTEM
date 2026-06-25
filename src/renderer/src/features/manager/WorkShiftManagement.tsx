import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppUser, EmployeeWorkShift, UserShiftAssignment, WeekDay } from '@shared/types'
import { MdAdd, MdDelete, MdEdit, MdRefresh, MdSave } from 'react-icons/md'
import { listAllAccounts } from '@renderer/features/auth/auth-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { getSettings, updateSettings } from '@renderer/features/orders/order-service'
import {
  deleteShiftAssignment,
  deleteWorkShift,
  getShiftAttendanceReport,
  listShiftAssignments,
  listWorkShifts,
  saveShiftAssignment,
  saveWorkShift,
  type ShiftAttendanceRow,
  type ShiftAssignmentInput,
  type WorkShiftInput
} from '@renderer/features/shifts/work-shift-service'

type PanelTab = 'schedules' | 'assignments' | 'reports'

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

function formatMinutes(value: number): string {
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  return hours ? `${hours}س ${minutes}د` : `${minutes}د`
}

export function WorkShiftManagement(): React.ReactElement {
  const actor = useAuthStore((state) => state.user)!
  const [enabled, setEnabled] = useState(false)
  const [activeTab, setActiveTab] = useState<PanelTab>('schedules')
  const [workShifts, setWorkShifts] = useState<EmployeeWorkShift[]>([])
  const [assignments, setAssignments] = useState<UserShiftAssignment[]>([])
  const [cashiers, setCashiers] = useState<AppUser[]>([])
  const [report, setReport] = useState<ShiftAttendanceRow[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [shiftForm, setShiftForm] = useState<WorkShiftInput>(EMPTY_SHIFT)
  const [editingShiftId, setEditingShiftId] = useState<string>()
  const [assignmentForm, setAssignmentForm] = useState<ShiftAssignmentInput>({
    userId: '',
    workShiftId: '',
    startDate: todayKey(),
    active: true
  })
  const [editingAssignmentId, setEditingAssignmentId] = useState<string>()
  const [reportUserId, setReportUserId] = useState('')
  const [reportWorkShiftId, setReportWorkShiftId] = useState('')
  const [reportFrom, setReportFrom] = useState('')
  const [reportTo, setReportTo] = useState('')

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

  const loadReport = useCallback(async () => {
    setReport(await getShiftAttendanceReport({
      userId: reportUserId || undefined,
      workShiftId: reportWorkShiftId || undefined,
      from: reportFrom || undefined,
      to: reportTo || undefined
    }))
  }, [reportFrom, reportTo, reportUserId, reportWorkShiftId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (activeTab === 'reports') void loadReport()
  }, [activeTab, loadReport])

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

  async function submitShift(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    clearFeedback()
    try {
      await saveWorkShift(shiftForm, actor, editingShiftId)
      setShiftForm(EMPTY_SHIFT)
      setEditingShiftId(undefined)
      setMessage(editingShiftId ? 'تم تعديل الوردية' : 'تم إنشاء الوردية')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر حفظ الوردية')
    }
  }

  function editShift(shift: EmployeeWorkShift): void {
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

  async function submitAssignment(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    clearFeedback()
    try {
      await saveShiftAssignment(assignmentForm, actor, editingAssignmentId)
      setAssignmentForm({ userId: '', workShiftId: '', startDate: todayKey(), active: true })
      setEditingAssignmentId(undefined)
      setMessage(editingAssignmentId ? 'تم تعديل التعيين' : 'تم تعيين الوردية للموظف')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر حفظ التعيين')
    }
  }

  function editAssignment(assignment: UserShiftAssignment): void {
    setEditingAssignmentId(assignment.id)
    setAssignmentForm({
      userId: assignment.userId,
      workShiftId: assignment.workShiftId,
      startDate: assignment.startDate,
      endDate: assignment.endDate,
      active: assignment.active
    })
  }

  async function removeAssignment(assignment: UserShiftAssignment): Promise<void> {
    clearFeedback()
    await deleteShiftAssignment(assignment.id, actor)
    setMessage('تم حذف التعيين')
    await load()
  }

  function handleTabKeys(event: React.KeyboardEvent<HTMLDivElement>): void {
    const tabs: PanelTab[] = ['schedules', 'assignments', 'reports']
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
    <section className="card" aria-labelledby="work-shifts-title">
      <div className="page-toolbar" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 id="work-shifts-title" className="card__title" style={{ margin: 0 }}>ورديات الموظفين والتحكم في الدخول</h2>
          <p className="modal-hint">عند التفعيل، لن يستطيع الكاشير الدخول أو البيع إلا داخل الوردية المعيّنة له.</p>
        </div>
        <label className="field field--checkbox" style={{ margin: 0 }}>
          <input type="checkbox" checked={enabled} onChange={() => void toggleFeature()} />
          <span>{enabled ? 'النظام مفعّل' : 'النظام متوقف'}</span>
        </label>
      </div>

      {message && <p className="form-message form-message--ok">{message}</p>}
      {error && <p className="form-message form-message--error">{error}</p>}

      <div className="inner-tabs" role="tablist" onKeyDown={handleTabKeys}>
        {([
          ['schedules', 'تعريف الورديات'],
          ['assignments', 'تعيين الموظفين'],
          ['reports', 'الحضور والأداء']
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
          <form className="settings-form-grid" onSubmit={(event) => void submitShift(event)}>
            <label className="field">
              <span>اسم الوردية</span>
              <input value={shiftForm.name} onChange={(event) => setShiftForm({ ...shiftForm, name: event.target.value })} placeholder="مثال: الوردية الصباحية" />
            </label>
            <label className="field">
              <span>وقت البداية</span>
              <input type="time" value={shiftForm.startTime} onChange={(event) => setShiftForm({ ...shiftForm, startTime: event.target.value })} />
            </label>
            <label className="field">
              <span>وقت النهاية</span>
              <input type="time" value={shiftForm.endTime} onChange={(event) => setShiftForm({ ...shiftForm, endTime: event.target.value })} />
            </label>
            <label className="field">
              <span>أقصى عمل إضافي بالدقائق</span>
              <input type="number" min="0" disabled={!shiftForm.overtimeEnabled} value={shiftForm.maxOvertimeMinutes} onChange={(event) => setShiftForm({ ...shiftForm, maxOvertimeMinutes: Number(event.target.value) })} />
            </label>
            <div className="field settings-form-grid__full">
              <span>أيام العمل</span>
              <div className="reports-filter__options">
                {DAYS.map((day) => (
                  <label key={day.value} className="field field--checkbox">
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
            <label className="field field--checkbox">
              <input type="checkbox" checked={shiftForm.active} onChange={(event) => setShiftForm({ ...shiftForm, active: event.target.checked })} />
              <span>الوردية نشطة</span>
            </label>
            <div className="form-actions settings-form-grid__full">
              <button className="btn btn--primary" type="submit"><MdSave /> {editingShiftId ? 'حفظ التعديل' : 'إضافة وردية'}</button>
              {editingShiftId && <button className="btn btn--secondary" type="button" onClick={() => { setEditingShiftId(undefined); setShiftForm(EMPTY_SHIFT) }}>إلغاء</button>}
            </div>
          </form>
          <table className="data-table">
            <thead><tr><th>الوردية</th><th>الوقت</th><th>الأيام</th><th>الإضافي</th><th>الحالة</th><th /></tr></thead>
            <tbody>
              {workShifts.length === 0 ? <tr><td colSpan={6}>لم تتم إضافة ورديات عمل بعد.</td></tr> : workShifts.map((shift) => (
                <tr key={shift.id}>
                  <td>{shift.name}</td>
                  <td dir="ltr">{shift.startTime} - {shift.endTime}</td>
                  <td>{DAYS.filter((day) => shift.workingDays.includes(day.value)).map((day) => day.label).join('، ')}</td>
                  <td>{shift.overtimeEnabled ? `${shift.maxOvertimeMinutes} دقيقة` : 'غير مسموح'}</td>
                  <td>{shift.active ? 'نشطة' : 'متوقفة'}</td>
                  <td><div className="table-actions">
                    <button className="btn btn--secondary btn--sm" type="button" onClick={() => editShift(shift)}><MdEdit /> تعديل</button>
                    <button className="btn btn--danger btn--sm" type="button" onClick={() => void removeShift(shift)}><MdDelete /> حذف</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {activeTab === 'assignments' && (
        <>
          <form className="settings-form-grid" onSubmit={(event) => void submitAssignment(event)}>
            <label className="field">
              <span>الكاشير</span>
              <select value={assignmentForm.userId} onChange={(event) => setAssignmentForm({ ...assignmentForm, userId: event.target.value })}>
                <option value="">اختر الحساب</option>
                {cashiers.map((user) => <option key={user.id} value={user.id}>{user.username} - {user.displayName}</option>)}
              </select>
            </label>
            <label className="field">
              <span>الوردية</span>
              <select value={assignmentForm.workShiftId} onChange={(event) => setAssignmentForm({ ...assignmentForm, workShiftId: event.target.value })}>
                <option value="">اختر الوردية</option>
                {workShifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}
              </select>
            </label>
            <label className="field"><span>من تاريخ</span><input type="date" value={assignmentForm.startDate} onChange={(event) => setAssignmentForm({ ...assignmentForm, startDate: event.target.value })} /></label>
            <label className="field"><span>حتى تاريخ (اختياري)</span><input type="date" value={assignmentForm.endDate ?? ''} onChange={(event) => setAssignmentForm({ ...assignmentForm, endDate: event.target.value || undefined })} /></label>
            <label className="field field--checkbox"><input type="checkbox" checked={assignmentForm.active} onChange={(event) => setAssignmentForm({ ...assignmentForm, active: event.target.checked })} /><span>التعيين نشط</span></label>
            <div className="form-actions settings-form-grid__full">
              <button className="btn btn--primary" type="submit"><MdAdd /> {editingAssignmentId ? 'حفظ التعديل' : 'تعيين الوردية'}</button>
              {editingAssignmentId && <button className="btn btn--secondary" type="button" onClick={() => { setEditingAssignmentId(undefined); setAssignmentForm({ userId: '', workShiftId: '', startDate: todayKey(), active: true }) }}>إلغاء</button>}
            </div>
          </form>
          <table className="data-table">
            <thead><tr><th>المستخدم</th><th>الوردية</th><th>الفترة</th><th>الحالة</th><th /></tr></thead>
            <tbody>
              {assignments.length === 0 ? <tr><td colSpan={5}>لا توجد تعيينات.</td></tr> : assignments.map((assignment) => (
                <tr key={assignment.id}>
                  <td>{userMap.get(assignment.userId)?.username ?? assignment.userId}</td>
                  <td>{shiftMap.get(assignment.workShiftId)?.name ?? 'وردية محذوفة'}</td>
                  <td>{assignment.startDate} - {assignment.endDate ?? 'مستمر'}</td>
                  <td>{assignment.active ? 'نشط' : 'متوقف'}</td>
                  <td><div className="table-actions">
                    <button className="btn btn--secondary btn--sm" type="button" onClick={() => editAssignment(assignment)}><MdEdit /> تعديل</button>
                    <button className="btn btn--danger btn--sm" type="button" onClick={() => void removeAssignment(assignment)}><MdDelete /> حذف</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {activeTab === 'reports' && (
        <>
          <div className="settings-form-grid" style={{ marginBottom: 16 }}>
            <label className="field"><span>الكاشير</span><select value={reportUserId} onChange={(event) => setReportUserId(event.target.value)}><option value="">الكل</option>{cashiers.map((user) => <option key={user.id} value={user.id}>{user.username}</option>)}</select></label>
            <label className="field"><span>الوردية</span><select value={reportWorkShiftId} onChange={(event) => setReportWorkShiftId(event.target.value)}><option value="">كل الورديات</option>{workShifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}</select></label>
            <label className="field"><span>من</span><input type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)} /></label>
            <label className="field"><span>إلى</span><input type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)} /></label>
            <div className="form-actions"><button className="btn btn--secondary" type="button" onClick={() => void loadReport()}><MdRefresh /> تحديث التقرير</button></div>
          </div>
          <table className="data-table">
            <thead><tr><th>المستخدم</th><th>الوردية</th><th>الدخول</th><th>الخروج</th><th>العمل</th><th>التأخير</th><th>الإضافي</th><th>الطلبات</th><th>المبيعات</th><th>فرق الكاش</th></tr></thead>
            <tbody>
              {report.length === 0 ? <tr><td colSpan={10}>لا توجد جلسات في الفترة المحددة.</td></tr> : report.map((row) => (
                <tr key={row.session.id}>
                  <td>{row.user?.username ?? row.session.cashierName}</td>
                  <td>{row.workShift?.name ?? row.session.workShiftName ?? 'غير مجدولة'}</td>
                  <td>{new Date(row.session.openedAt).toLocaleString('ar-EG')}</td>
                  <td>{row.session.closedAt ? new Date(row.session.closedAt).toLocaleString('ar-EG') : 'مفتوح'}</td>
                  <td>{formatMinutes(row.workedMinutes)}</td>
                  <td>{formatMinutes(row.lateMinutes)}</td>
                  <td>{formatMinutes(row.overtimeMinutes)}</td>
                  <td>{row.orderCount}</td>
                  <td>{row.revenue.toFixed(2)}</td>
                  <td>{row.cashDifference === undefined ? '-' : row.cashDifference.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
