import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { AppUser } from '@shared/types'
import { ConfirmDeleteButton } from '@renderer/components/ConfirmDeleteButton'
import {
  listUsersByRole,
  createCashierAccount,
  updateUserActive,
  updateUserProfile,
  resetCashierPassword,
  deleteAccount
} from '@renderer/features/auth/auth-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { MdEdit, MdCheck, MdClose, MdLock } from 'react-icons/md'
import { PasswordInput } from '@renderer/components/PasswordInput'

type EditMode = 'profile' | 'password' | null

export function CashiersPage(): React.ReactElement {
  const manager = useAuthStore((s) => s.user)!
  const [cashiers, setCashiers] = useState<AppUser[]>([])
  const [form, setForm] = useState({ username: '', displayName: '', cashierCode: '', password: '' })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editMode, setEditMode] = useState<EditMode>(null)
  const [editingName, setEditingName] = useState('')
  const [editingCode, setEditingCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [editError, setEditError] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  const load = useCallback(async () => {
    setCashiers(await listUsersByRole('cashier'))
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleCreate(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    setMessage('')
    if (form.username.includes('@') || form.username.includes(' ')) {
      setError('اسم المستخدم لا يمكن أن يحتوي على @ أو مسافات')
      return
    }
    try {
      await createCashierAccount(
        {
          username: form.username.trim(),
          displayName: form.displayName.trim(),
          cashierCode: form.cashierCode.trim().toUpperCase(),
          role: 'cashier',
          permissions: ['pos', 'order_history', 'cashier_inventory'],
          password: form.password
        },
        manager.id
      )
      setForm({ username: '', displayName: '', cashierCode: '', password: '' })
      setMessage('تم إنشاء الحساب بنجاح')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل إنشاء الحساب')
    }
  }

  function startEditProfile(c: AppUser): void {
    setEditingId(c.id)
    setEditMode('profile')
    setEditingName(c.displayName)
    setEditingCode(c.cashierCode ?? '')
    setEditError('')
  }

  function startEditPassword(c: AppUser): void {
    setEditingId(c.id)
    setEditMode('password')
    setNewPassword('')
    setEditError('')
  }

  function cancelEdit(): void {
    setEditingId(null)
    setEditMode(null)
    setEditError('')
  }

  async function saveProfile(): Promise<void> {
    if (!editingId || !editingName.trim()) return
    setEditSaving(true)
    try {
      await updateUserProfile(editingId, {
        displayName: editingName.trim(),
        cashierCode: editingCode.trim().toUpperCase()
      })
      setMessage('تم تعديل بيانات الكاشير')
      cancelEdit()
      await load()
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'فشل')
    } finally {
      setEditSaving(false)
    }
  }

  async function savePassword(): Promise<void> {
    if (!editingId) return
    if (newPassword.length < 6) {
      setEditError('كلمة المرور يجب أن تكون 6 أحرف على الأقل')
      return
    }
    setEditSaving(true)
    try {
      await resetCashierPassword(editingId, newPassword)
      setMessage('تم تغيير كلمة المرور')
      cancelEdit()
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'فشل')
    } finally {
      setEditSaving(false)
    }
  }

  return (
    <>
      {message && <p className="form-message form-message--ok" role="status">{message}</p>}

      <div className="card">
        <h2 className="card__title">إضافة كاشير</h2>
        <form onSubmit={(e) => void handleCreate(e)}>
          <label className="field">
            <span>الاسم الكامل</span>
            <input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} required />
          </label>
          <label className="field">
            <span>اسم المستخدم (للدخول)</span>
            <input
              dir="ltr"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              required
              placeholder="cashier1"
              autoComplete="off"
            />
            <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
              سيُستخدم هذا للدخول - بدون مسافات أو @
            </span>
          </label>
          <label className="field">
            <span>كود الكاشير على الإيصال</span>
            <input
              value={form.cashierCode}
              onChange={(e) => setForm((f) => ({ ...f, cashierCode: e.target.value.toUpperCase().slice(0, 2) }))}
              required
              minLength={2}
              maxLength={2}
              dir="ltr"
              placeholder="AA"
            />
          </label>
          <label className="field">
            <span>كلمة المرور</span>
            <PasswordInput value={form.password} onChange={(v) => setForm((f) => ({ ...f, password: v }))} autoComplete="new-password" required />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn btn--primary">إنشاء حساب</button>
        </form>
      </div>

      <div className="card">
        <h2 className="card__title">حسابات الكاشير</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>اسم المستخدم</th>
              <th>الكود</th>
              <th>الحالة</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {cashiers.map((c) => {
              const isEditing = editingId === c.id
              return (
                <tr key={c.id}>
                  <td>
                    {isEditing && editMode === 'profile' ? (
                      <input
                        className="inline-edit-input"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void saveProfile(); if (e.key === 'Escape') cancelEdit() }}
                        autoFocus
                      />
                    ) : c.displayName}
                  </td>
                  <td dir="ltr" style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>
                    {c.username || c.email.split('@')[0]}
                  </td>
                  <td dir="ltr">
                    {isEditing && editMode === 'profile' ? (
                      <input
                        className="inline-edit-input"
                        value={editingCode}
                        maxLength={2}
                        onChange={(e) => setEditingCode(e.target.value.toUpperCase().slice(0, 2))}
                        dir="ltr"
                      />
                    ) : (c.cashierCode ?? '--')}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`btn btn--sm ${c.active ? 'btn--secondary' : 'btn--danger'}`}
                      onClick={() => void updateUserActive(c.id, !c.active).then(load)}
                    >
                      {c.active ? 'مفعّل' : 'معطّل'}
                    </button>
                  </td>
                  <td>
                    {isEditing && editError && (
                      <p style={{ color: 'var(--color-danger)', fontSize: '0.78rem', margin: '0 0 4px' }}>{editError}</p>
                    )}

                    {isEditing && editMode === 'password' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 6 }}>
                        <PasswordInput value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
                        <div className="table-actions">
                          <button type="button" className="btn btn--primary btn--sm" onClick={() => void savePassword()} disabled={editSaving}>
                            <MdCheck /> {editSaving ? '...' : 'حفظ'}
                          </button>
                          <button type="button" className="btn btn--secondary btn--sm" onClick={cancelEdit}>
                            <MdClose />
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="table-actions">
                      {isEditing && editMode === 'profile' ? (
                        <>
                          <button type="button" className="btn btn--primary btn--sm" onClick={() => void saveProfile()} disabled={editSaving}>
                            <MdCheck /> {editSaving ? '...' : 'حفظ'}
                          </button>
                          <button type="button" className="btn btn--secondary btn--sm" onClick={cancelEdit}>
                            <MdClose />
                          </button>
                        </>
                      ) : !isEditing ? (
                        <>
                          <button type="button" className="btn btn--secondary btn--sm" onClick={() => startEditProfile(c)}>
                            <MdEdit /> البيانات
                          </button>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => startEditPassword(c)}
                            title="تغيير كلمة المرور"
                          >
                            <MdLock /> كلمة المرور
                          </button>
                          <ConfirmDeleteButton
                            confirmMessage={`حذف حساب "${c.displayName}" نهائيا؟`}
                            onConfirm={async () => {
                              if (!navigator.onLine) {
                                setError('لا يمكن الحذف بدون اتصال')
                                return
                              }
                              await deleteAccount(c.id, manager.id)
                              await load()
                            }}
                          />
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}