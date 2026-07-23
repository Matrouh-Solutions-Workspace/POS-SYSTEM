/**
 * الحسابات — flexible account management.
 * Manager creates accounts and picks exactly which features each one can access.
 * Roles are presets only — permissions are stored per-user and fully customisable.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { AppUser, UserRole, Permission } from '@shared/types'
import {
  ROLE_PRESET_PERMISSIONS,
  ROLE_LABELS,
  PERMISSION_LABELS,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_GROUPS,
  getUserPermissions
} from '@shared/types/user'
import {
  listAllAccounts,
  createAccount,
  updateUserActive,
  updateUserProfile,
  resetCashierPassword,
  deleteAccount
} from '@renderer/features/auth/auth-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { ConfirmDialog, FormModal, FormField } from '@renderer/components/ui'
import { PasswordInput } from '@renderer/components/PasswordInput'
import { hashPin } from '@renderer/features/auth/pin-store'
import { MdEdit, MdCheck, MdClose, MdLock, MdPeople, MdShield, MdAdd, MdPerson, MdExpandMore, MdExpandLess } from 'react-icons/md'

// ── Permission picker component ─────────────────────────────────────────────

function PermissionPicker({
  value,
  onChange,
  disabled = false
}: {
  value: Permission[]
  onChange: (perms: Permission[]) => void
  disabled?: boolean
}): React.ReactElement {
  function toggle(perm: Permission): void {
    if (disabled) return
    const next = value.includes(perm)
      ? value.filter((p) => p !== perm)
      : [...value, perm]
    onChange(next)
  }

  function setAll(perms: Permission[]): void {
    if (disabled) return
    const allChecked = perms.every((p) => value.includes(p))
    if (allChecked) {
      onChange(value.filter((p) => !perms.includes(p)))
    } else {
      const merged = [...value]
      for (const p of perms) {
        if (!merged.includes(p)) merged.push(p)
      }
      onChange(merged)
    }
  }

  return (
    <div className="perm-picker">
      {PERMISSION_GROUPS.map((group) => {
        const allChecked = group.perms.every((p) => value.includes(p))
        const someChecked = group.perms.some((p) => value.includes(p))
        return (
          <div key={group.label} className="perm-group">
            <button
              type="button"
              className={`perm-group__header${allChecked ? ' perm-group__header--all' : someChecked ? ' perm-group__header--some' : ''}`}
              onClick={() => setAll(group.perms)}
              disabled={disabled}
            >
              <span className={`perm-group__check${allChecked ? ' perm-group__check--on' : ''}`}>
                {allChecked ? '☑' : someChecked ? '⊟' : '☐'}
              </span>
              {group.label}
            </button>
            <div className="perm-group__items">
              {group.perms.map((perm) => {
                const checked = value.includes(perm)
                return (
                  <label key={perm} className={`perm-item${checked ? ' perm-item--on' : ''}${disabled ? ' perm-item--disabled' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(perm)}
                      disabled={disabled}
                      className="perm-item__checkbox"
                    />
                    <div className="perm-item__text">
                      <span className="perm-item__label">{PERMISSION_LABELS[perm]}</span>
                      <span className="perm-item__desc">{PERMISSION_DESCRIPTIONS[perm]}</span>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Preset bar ──────────────────────────────────────────────────────────────

function PresetBar({ onSelect }: { onSelect: (perms: Permission[]) => void }): React.ReactElement {
  const presets: { role: UserRole; label: string }[] = [
    { role: 'cashier',    label: 'كاشير (أساسي)' },
    { role: 'supervisor', label: 'مشرف' },
    { role: 'manager',    label: 'مدير (كامل)' }
  ]
  return (
    <div className="preset-bar">
      <span className="preset-bar__label">ابدأ من قالب:</span>
      {presets.map(({ role, label }) => (
        <button
          key={role}
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => onSelect(ROLE_PRESET_PERMISSIONS[role])}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ── Create account modal ─────────────────────────────────────────────────────

function CreateAccountModal({ open, currentUser, onCreated, onClose }: {
  open: boolean
  currentUser: AppUser
  onCreated: (msg: string) => Promise<void>
  onClose: () => void
}): React.ReactElement {
  const [form, setForm] = useState({
    username: '', displayName: '', cashierCode: '', password: '',
    role: 'cashier' as UserRole
  })
  const [perms, setPerms] = useState<Permission[]>([...ROLE_PRESET_PERMISSIONS.cashier])
  const [allowCashRounding, setAllowCashRounding] = useState(false)
  const [maxCashRoundingDifference, setMaxCashRoundingDifference] = useState('')

  // reset on open
  useEffect(() => {
    if (open) {
      setForm({ username: '', displayName: '', cashierCode: '', password: '', role: 'cashier' })
      setPerms([...ROLE_PRESET_PERMISSIONS.cashier])
      setAllowCashRounding(false)
      setMaxCashRoundingDifference('')
    }
  }, [open])

  function handleRoleChange(role: UserRole): void {
    setForm((f) => ({ ...f, role }))
    setPerms([...ROLE_PRESET_PERMISSIONS[role]])
  }

  async function handleSubmit(): Promise<void> {
    if (form.username.includes('@') || form.username.includes(' ')) {
      throw new Error('اسم المستخدم لا يمكن أن يحتوي على @ أو مسافات')
    }
    if (form.password.length < 6) { throw new Error('كلمة المرور يجب أن تكون 6 أحرف على الأقل') }
    if (perms.length === 0) { throw new Error('اختر صلاحية واحدة على الأقل') }
    
    await createAccount(
      {
        username: form.username.trim(),
        displayName: form.displayName.trim(),
        cashierCode: form.cashierCode.trim().toUpperCase() || undefined,
        role: form.role,
        permissions: perms,
        allowCashRounding,
        maxCashRoundingDifference: allowCashRounding && maxCashRoundingDifference
          ? Number(maxCashRoundingDifference)
          : undefined,
        password: form.password
      },
      currentUser.id
    )
    await onCreated(`تم إنشاء حساب "${form.displayName}" بنجاح`)
  }

  return (
    <FormModal
      open={open}
      onClose={onClose}
      entityName="حساب"
      onSubmit={handleSubmit}
      maxWidth={700}
    >
      <div className="settings-form-grid mb-16">
        <FormField label="الاسم الكامل" required>
          <input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} placeholder="مثال: أحمد محمد" required autoFocus />
        </FormField>
        <FormField label="اسم المستخدم (للدخول)" required>
          <input dir="ltr" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} placeholder="ahmed" required autoComplete="off" />
        </FormField>
        <FormField label="كود الإيصال (2 حرف/رقم — اختياري)">
          <input value={form.cashierCode} onChange={(e) => setForm((f) => ({ ...f, cashierCode: e.target.value.toUpperCase().slice(0, 2) }))} placeholder="AA" dir="ltr" maxLength={2} />
        </FormField>
        <FormField label="الدور" required>
          <select value={form.role} onChange={(e) => handleRoleChange(e.target.value as UserRole)}>
            {(Object.entries(ROLE_LABELS) as [UserRole, string][]).map(([role, label]) => (
              <option key={role} value={role}>{label}</option>
            ))}
          </select>
        </FormField>
        <FormField label="كلمة المرور" required>
          <PasswordInput value={form.password} onChange={(v) => setForm((f) => ({ ...f, password: v }))} autoComplete="new-password" required />
        </FormField>
      </div>

      <div className="perm-section">
        <div className="perm-section__header">
          <strong>الصلاحيات</strong>
          <span className="perm-count">{perms.length} من {Object.keys(PERMISSION_LABELS).length}</span>
        </div>
        <PresetBar onSelect={setPerms} />
        <PermissionPicker value={perms} onChange={setPerms} />
        <div className="settings-form-grid mt-12">
          <label className="field field--checkbox">
            <input type="checkbox" checked={allowCashRounding} onChange={(event) => setAllowCashRounding(event.target.checked)} />
            <span>السماح بتقريب الدفع النقدي</span>
          </label>
          <FormField label="حد الموظف (فارغ = الحد العام)">
            <input type="number" min="0" step="0.01" disabled={!allowCashRounding} value={maxCashRoundingDifference} onChange={(event) => setMaxCashRoundingDifference(event.target.value)} placeholder="مثال: 5.00" />
          </FormField>
        </div>
      </div>
    </FormModal>
  )
}

// ── Account card ────────────────────────────────────────────────────────────

const ROLE_BADGE_CLASS: Record<UserRole, string> = {
  manager:    'role-badge role-badge--manager',
  supervisor: 'role-badge role-badge--supervisor',
  cashier:    'role-badge role-badge--cashier'
}

type EditMode = 'profile' | 'password' | 'pin' | null

function AccountCard({ account, currentUser, onRefresh, setMessage }: {
  account: AppUser
  currentUser: AppUser
  onRefresh: () => Promise<void>
  setMessage: (m: string | null) => void
}): React.ReactElement {
  const isMe = account.id === currentUser.id
  const [editMode, setEditMode] = useState<EditMode>(null)
  const [expanded, setExpanded] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  // Profile edit state
  const [editName, setEditName] = useState(account.displayName)
  const [editCode, setEditCode] = useState(account.cashierCode ?? '')
  const [editPerms, setEditPerms] = useState<Permission[]>(getUserPermissions(account))
  const [editAllowCashRounding, setEditAllowCashRounding] = useState(account.allowCashRounding ?? false)
  const [editMaxCashRoundingDifference, setEditMaxCashRoundingDifference] = useState(
    account.maxCashRoundingDifference != null ? String(account.maxCashRoundingDifference) : ''
  )

  // Password edit
  const [editPassword, setEditPassword] = useState('')
  // PIN edit
  const [editPin, setEditPin] = useState('')

  function startEdit(mode: EditMode): void {
    setEditMode(mode)
    if (mode === 'profile') {
      setEditName(account.displayName)
      setEditCode(account.cashierCode ?? '')
      setEditPerms(getUserPermissions(account))
      setEditAllowCashRounding(account.allowCashRounding ?? false)
      setEditMaxCashRoundingDifference(account.maxCashRoundingDifference != null ? String(account.maxCashRoundingDifference) : '')
    }
    setEditPassword('')
    setEditPin('')
  }

  function cancelEdit(): void {
    setEditMode(null)
  }

  async function saveProfile(): Promise<void> {
    if (!editName.trim()) throw new Error('الاسم مطلوب')
    if (editPerms.length === 0) { throw new Error('اختر صلاحية واحدة على الأقل') }
    
    await updateUserProfile(account.id, {
      displayName: editName.trim(),
      cashierCode: editCode.trim().toUpperCase() || undefined,
      permissions: account.role === 'manager' ? undefined : editPerms,
      allowCashRounding: account.role === 'manager' ? true : editAllowCashRounding,
      maxCashRoundingDifference: editAllowCashRounding && editMaxCashRoundingDifference
        ? Number(editMaxCashRoundingDifference)
        : undefined
    }, currentUser)
    setMessage('تم تعديل بيانات الحساب')
    cancelEdit()
    await onRefresh()
  }

  async function savePassword(): Promise<void> {
    if (editPassword.length < 6) { throw new Error('كلمة المرور يجب أن تكون 6 أحرف على الأقل') }
    await resetCashierPassword(account.id, editPassword, currentUser)
    setMessage('تم تغيير كلمة المرور')
    cancelEdit()
  }

  async function savePin(): Promise<void> {
    if (editPin && (editPin.length !== 4 || !/^\d{4}$/.test(editPin))) {
      throw new Error('رمز PIN يجب أن يكون 4 أرقام')
    }
    const pinHash = editPin ? await hashPin(editPin) : undefined
    await updateUserProfile(account.id, { pinHash }, currentUser)
    setMessage(editPin ? 'تم تعيين PIN' : 'تم حذف PIN')
    cancelEdit()
    await onRefresh()
  }

  const effectivePerms = getUserPermissions(account)

  return (
    <div className={`account-card${!account.active ? ' account-card--inactive' : ''}`}>
      {/* Header */}
      <div className="account-card__header">
        <div className="account-card__avatar"><MdPerson aria-hidden="true" /></div>
        <div className="account-card__info">
          <span className="account-card__name">
            {account.displayName}
            {isMe && <em style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginRight: 6 }}>(أنت)</em>}
          </span>
          <span className="account-card__username" dir="ltr">@{account.username}</span>
        </div>
        <div className="account-card__badges">
          <span className={ROLE_BADGE_CLASS[account.role]}>{ROLE_LABELS[account.role]}</span>
          {account.cashierCode && <span className="code-badge" dir="ltr">{account.cashierCode}</span>}
          {account.pinHash && <span className="pin-badge">PIN ✓</span>}
          {(account.role === 'manager' || account.allowCashRounding) && (
            <span className="code-badge">تقريب نقدي{account.maxCashRoundingDifference != null ? ` ≤ ${account.maxCashRoundingDifference}` : ''}</span>
          )}
          <span className="perm-count-badge">{effectivePerms.length} صلاحية</span>
        </div>
      </div>

      {/* Permissions summary (collapsed/expanded) */}
      <button
        type="button"
        className="perm-summary-toggle"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <MdExpandLess /> : <MdExpandMore />}
        {expanded ? 'إخفاء الصلاحيات' : 'عرض الصلاحيات'}
      </button>

      {expanded && (
        <div className="perm-summary">
          {PERMISSION_GROUPS.map((group) => {
            const granted = group.perms.filter((p) => effectivePerms.includes(p))
            if (granted.length === 0) return null
            return (
              <div key={group.label} className="perm-summary__group">
                <span className="perm-summary__group-label">{group.label}</span>
                <div className="perm-summary__items">
                  {granted.map((p) => (
                    <span key={p} className="perm-summary__item">{PERMISSION_LABELS[p]}</span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modals for edit modes */}
      <FormModal
        open={editMode === 'profile'}
        onClose={cancelEdit}
        entityName="بيانات الحساب"
        isEdit
        onSubmit={saveProfile}
        maxWidth={700}
      >
        <div className="settings-form-grid mb-12">
          <FormField label="الاسم الكامل" required>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus required />
          </FormField>
          <FormField label="كود الإيصال">
            <input value={editCode} maxLength={2} onChange={(e) => setEditCode(e.target.value.toUpperCase().slice(0, 2))} dir="ltr" style={{ width: 80 }} />
          </FormField>
        </div>
        {account.role !== 'manager' && (
          <div className="perm-section">
            <div className="perm-section__header">
              <strong>الصلاحيات</strong>
              <span className="perm-count">{editPerms.length} من {Object.keys(PERMISSION_LABELS).length}</span>
            </div>
            <PresetBar onSelect={setEditPerms} />
            <PermissionPicker value={editPerms} onChange={setEditPerms} />
            <div className="settings-form-grid mt-12">
              <label className="field field--checkbox">
                <input type="checkbox" checked={editAllowCashRounding} onChange={(event) => setEditAllowCashRounding(event.target.checked)} />
                <span>السماح بتقريب الدفع النقدي</span>
              </label>
              <FormField label="حد الموظف (فارغ = الحد العام)">
                <input type="number" min="0" step="0.01" disabled={!editAllowCashRounding} value={editMaxCashRoundingDifference} onChange={(event) => setEditMaxCashRoundingDifference(event.target.value)} placeholder="مثال: 5.00" />
              </FormField>
            </div>
          </div>
        )}
        {account.role === 'manager' && (
          <p style={{ fontSize: '0.82rem', color: 'var(--color-muted)', marginBottom: 8 }}>
            حساب المدير يملك صلاحيات كاملة دائماً ولا يمكن تقييدها
          </p>
        )}
      </FormModal>

      <FormModal
        open={editMode === 'password'}
        onClose={cancelEdit}
        entityName="كلمة المرور"
        title="تغيير كلمة المرور"
        onSubmit={savePassword}
        maxWidth={400}
      >
        <FormField label="كلمة المرور الجديدة" required>
          <PasswordInput value={editPassword} onChange={setEditPassword} autoComplete="new-password" />
        </FormField>
      </FormModal>

      <FormModal
        open={editMode === 'pin'}
        onClose={cancelEdit}
        entityName="رمز PIN"
        title="تعديل PIN"
        onSubmit={savePin}
        maxWidth={400}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <p style={{ fontSize: '0.9rem', marginBottom: 16 }}>أدخل 4 أرقام، أو اترك الحقل فارغاً لحذف الـ PIN</p>
          <input
            type="password" inputMode="numeric" maxLength={4}
            value={editPin} onChange={(e) => setEditPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="****"
            style={{ width: 120, textAlign: 'center', letterSpacing: '0.4em', fontSize: '1.5rem', padding: '12px' }}
            autoFocus
          />
        </div>
      </FormModal>

      {/* Action row */}
      <div className="account-card__actions">
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => startEdit('profile')}><MdEdit /> تعديل</button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => startEdit('password')}><MdLock /> كلمة المرور</button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => startEdit('pin')}><MdShield /> PIN</button>
        <button
          type="button"
          className={`btn btn--sm ${account.active ? 'btn--secondary' : 'btn--danger'}`}
          onClick={() => void updateUserActive(account.id, !account.active, currentUser.id, currentUser.username).then(onRefresh)}
          disabled={isMe}
        >
          {account.active ? 'مفعّل' : 'معطّل'}
        </button>
        {!isMe && (
          <ConfirmDialog
            open={deleteConfirmOpen}
            onCancel={() => setDeleteConfirmOpen(false)}
            onConfirm={async () => {
              await deleteAccount(account.id, currentUser.id)
              setMessage(`تم حذف حساب "${account.displayName}"`)
              setDeleteConfirmOpen(false)
              await onRefresh()
            }}
            title="تأكيد الحذف"
            message={`حذف حساب "${account.displayName}"؟`}
            confirmLabel="حذف"
            danger
          />
        )}
        {!isMe && (
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={() => setDeleteConfirmOpen(true)}
          >
            حذف
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────

type AccountsTab = 'accounts' | 'roles'

export function AccountsPage(): React.ReactElement {
  const currentUser = useAuthStore((s) => s.user)!
  const [activeTab, setActiveTab] = useState<AccountsTab>('accounts')
  const [accounts, setAccounts] = useState<AppUser[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    setAccounts(await listAllAccounts())
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 4000)
    return () => clearTimeout(t)
  }, [message])

  async function handleCreated(msg: string): Promise<void> {
    setShowCreate(false)
    setMessage(msg)
    await load()
  }

  const tabs: { key: AccountsTab; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'accounts', label: 'الحسابات',          icon: <MdPeople />,  count: accounts.length },
    { key: 'roles',    label: 'دليل الصلاحيات',     icon: <MdShield /> }
  ]

  function handleAccountsTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    const currentIndex = tabs.findIndex((t) => t.key === activeTab)
    let nextIndex = currentIndex
    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length
    else if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') nextIndex = 0
    else if (e.key === 'End') nextIndex = tabs.length - 1
    else return
    e.preventDefault()
    setActiveTab(tabs[nextIndex]!.key)
  }

  return (
    <div className="unified-page">
      <div className="inner-tabs" role="tablist" onKeyDown={handleAccountsTabKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={activeTab === t.key}
            tabIndex={activeTab === t.key ? 0 : -1}
            className={`inner-tab${activeTab === t.key ? ' inner-tab--active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.icon}
            {t.label}
            {t.count !== undefined && <span className="inner-tab__count">{t.count}</span>}
          </button>
        ))}
      </div>

      {message && (
        <p className={`form-message ${message.includes('فشل') ? 'form-message--error' : 'form-message--ok'}`} role="status">
          {message}
        </p>
      )}

      {activeTab === 'accounts' && (
        <div className="tab-content">
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn--primary" onClick={() => setShowCreate(true)}>
              <MdAdd aria-hidden="true" />
              إضافة حساب جديد
            </button>
          </div>

          <CreateAccountModal
            open={showCreate}
            currentUser={currentUser}
            onCreated={handleCreated}
            onClose={() => setShowCreate(false)}
          />

          <div className="accounts-list">
            {accounts.length === 0 && <p className="report-empty">لا توجد حسابات بعد</p>}
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                currentUser={currentUser}
                onRefresh={load}
                setMessage={setMessage}
              />
            ))}
          </div>
        </div>
      )}

      {activeTab === 'roles' && (
        <div className="tab-content">
          <div className="roles-info-banner">
            <MdShield aria-hidden="true" />
            هذه قوالب مساعدة فقط — يمكنك تخصيص صلاحيات كل حساب بشكل مستقل عند الإنشاء أو التعديل
          </div>
          <div className="roles-grid">
            {(['cashier', 'supervisor', 'manager'] as UserRole[]).map((role) => {
              const perms = ROLE_PRESET_PERMISSIONS[role]
              const ROLE_BADGE_CLASS_MAP: Record<UserRole, string> = {
                manager: 'role-badge role-badge--manager',
                supervisor: 'role-badge role-badge--supervisor',
                cashier: 'role-badge role-badge--cashier'
              }
              return (
                <div key={role} className={`role-card role-card--${role}`}>
                  <div className="role-card__header">
                    <span className={ROLE_BADGE_CLASS_MAP[role]}>{ROLE_LABELS[role]}</span>
                    <p className="role-card__desc">{perms.length} صلاحية في القالب الافتراضي</p>
                  </div>
                  <ul className="role-card__perms">
                    {(Object.entries(PERMISSION_LABELS) as [Permission, string][]).map(([perm, label]) => {
                      const allowed = perms.includes(perm)
                      return (
                        <li key={perm} className={`role-perm${allowed ? ' role-perm--on' : ' role-perm--off'}`}>
                          <span className="role-perm__dot">{allowed ? '✓' : '✗'}</span>
                          {label}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
