import { useEffect, useState, type FormEvent } from 'react'
import type { AppSettings } from '@shared/types'
import { getSettings, updateSettings } from '@renderer/features/orders/order-service'
import { applyThemeColor, DEFAULT_PRIMARY } from '@renderer/features/theme/theme-store'
import { listUsersByRole, updateUserProfile } from '@renderer/features/auth/auth-service'
import { hashPin } from '@renderer/features/auth/pin-store'
import { MdSave, MdPalette, MdLock, MdPerson, MdBackup, MdRestorePage, MdKeyboard } from 'react-icons/md'
import type { AppUser } from '@shared/types'
import {
  SHORTCUT_ACTIONS,
  chordToDisplay,
  eventToChord,
  resolveChords,
  useKeyboardStore
} from '@renderer/features/keyboard/keyboard-store'

const COLOR_PRESETS = [
  { label: 'فيروزي (افتراضي)', value: '#0e7490' },
  { label: 'برتقالي',          value: '#b8430a' },
  { label: 'أزرق',             value: '#1d4ed8' },
  { label: 'أخضر',             value: '#15803d' },
  { label: 'بنفسجي',           value: '#7c3aed' },
  { label: 'وردي',             value: '#be185d' },
  { label: 'رمادي',            value: '#374151' },
  { label: 'أحمر',             value: '#b91c1c' }
]

const LOCK_OPTIONS = [
  { value: 0,   label: 'لا يُقفل تلقائياً' },
  { value: 1,   label: 'دقيقة واحدة' },
  { value: 5,   label: '٥ دقائق' },
  { value: 10,  label: '١٠ دقائق' },
  { value: 15,  label: '١٥ دقيقة' },
  { value: 30,  label: '٣٠ دقيقة' },
  { value: 60,  label: 'ساعة' }
]

// ── ShortcutsTab ─────────────────────────────────────────────────────────

function ShortcutsTab(): React.ReactElement {
  const storeChords = useKeyboardStore((s) => s.chords)
  const setChord    = useKeyboardStore((s) => s.setChord)

  // Local draft so the user can edit without immediately affecting behaviour
  const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...storeChords }))
  // Which action is currently being recorded
  const [recording, setRecording] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // Keep draft in sync if the store changes externally (e.g. load on mount)
  useEffect(() => {
    setDraft({ ...storeChords })
  }, [storeChords])

  // Capture a keydown while in recording mode
  useEffect(() => {
    if (!recording) return
    function capture(e: KeyboardEvent): void {
      e.preventDefault()
      e.stopPropagation()
      // Escape cancels recording without changing the chord
      if (e.key === 'Escape') { setRecording(null); return }
      const chord = eventToChord(e)
      // Ignore bare modifiers alone
      if (['ctrl', 'alt', 'shift', 'meta'].includes(chord)) return
      setDraft((d) => ({ ...d, [recording!]: chord }))
      setRecording(null)
    }
    window.addEventListener('keydown', capture, { capture: true })
    return () => window.removeEventListener('keydown', capture, { capture: true })
  }, [recording])

  // Detect conflicts in draft
  function conflictFor(actionId: string): string | null {
    const chord = draft[actionId]
    if (!chord) return null
    for (const [otherId, otherChord] of Object.entries(draft)) {
      if (otherId !== actionId && otherChord === chord) {
        const other = SHORTCUT_ACTIONS.find((a) => a.id === otherId)
        return other?.labelAr ?? otherId
      }
    }
    return null
  }

  async function handleSave(): Promise<void> {
    setSaving(true)
    setMsg(null)
    try {
      // Apply to store immediately
      for (const [id, chord] of Object.entries(draft)) {
        setChord(id, chord)
      }
      await updateSettings({ keyboardShortcuts: draft })
      setMsg('تم حفظ الاختصارات ✓')
    } catch { setMsg('فشل الحفظ') }
    finally { setSaving(false) }
  }

  function handleReset(): void {
    const defaults = resolveChords({})
    setDraft({ ...defaults })
  }

  // Group actions by groupAr
  const groups = SHORTCUT_ACTIONS.reduce<Record<string, typeof SHORTCUT_ACTIONS>>((acc, a) => {
    ;(acc[a.groupAr] ??= []).push(a)
    return acc
  }, {})

  return (
    <div className="shortcuts-tab">
      <p className="shortcuts-tab__hint">
        اضغط على زر الاختصار ثم اضغط المفاتيح الجديدة. اضغط Escape للإلغاء.
      </p>

      {msg && (
        <p className={`form-message ${msg.includes('فشل') ? 'form-message--error' : 'form-message--ok'}`}>
          {msg}
        </p>
      )}

      {Object.entries(groups).map(([group, actions]) => (
        <div key={group} className="card">
          <h2 className="card__title">{group}</h2>
          <table className="data-table shortcuts-table">
            <thead>
              <tr>
                <th>الإجراء</th>
                <th>الاختصار</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((action) => {
                const chord = draft[action.id] ?? ''
                const isRecording = recording === action.id
                const conflict = conflictFor(action.id)
                return (
                  <tr key={action.id} className={conflict ? 'shortcut-row--conflict' : ''}>
                    <td>{action.labelAr}</td>
                    <td>
                      <button
                        type="button"
                        className={`shortcut-chord-btn${isRecording ? ' shortcut-chord-btn--recording' : ''}`}
                        onClick={() => setRecording(isRecording ? null : action.id)}
                        title={isRecording ? 'اضغط المفاتيح أو Escape للإلغاء' : 'انقر لتغيير الاختصار'}
                      >
                        {isRecording ? (
                          <span className="shortcut-chord-btn__recording-label">اضغط المفاتيح…</span>
                        ) : chord ? (
                          chordToDisplay(chord)
                        ) : (
                          <span style={{ color: 'var(--color-muted)', fontStyle: 'italic' }}>غير مُعيَّن</span>
                        )}
                      </button>
                      {conflict && (
                        <div className="shortcut-conflict-msg">
                          ⚠️ تعارض مع: {conflict}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => {
                            const def = SHORTCUT_ACTIONS.find((a) => a.id === action.id)?.defaultChord ?? ''
                            setDraft((d) => ({ ...d, [action.id]: def }))
                          }}
                          title="استعادة الاختصار الافتراضي"
                        >
                          افتراضي
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => setDraft((d) => ({ ...d, [action.id]: '' }))}
                          title="إزالة الاختصار"
                        >
                          مسح
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}

      <div className="form-actions">
        <button type="button" className="btn btn--primary" onClick={() => void handleSave()} disabled={saving}>
          <MdSave /> {saving ? 'جارٍ الحفظ…' : 'حفظ الاختصارات'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={handleReset}>
          استعادة الافتراضي للكل
        </button>
      </div>
    </div>
  )
}

export function SettingsPage(): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [cashiers, setCashiers] = useState<AppUser[]>([])

  // ── Receipt ─────────────────────────────────────────────────────────────
  const [receiptForm, setReceiptForm] = useState({ restaurantNameAr: '', currencySymbol: '', phoneNumber: '', receiptFooterAr: '', taxRate: '', defaultDeliveryFee: '', maxCashierDiscountPct: '' })
  const [receiptSaving, setReceiptSaving] = useState(false)
  const [receiptMsg, setReceiptMsg] = useState<string | null>(null)

  // ── Theme ────────────────────────────────────────────────────────────────
  const [selectedColor, setSelectedColor] = useState(DEFAULT_PRIMARY)
  const [customColor, setCustomColor] = useState(DEFAULT_PRIMARY)
  const [themeSaving, setThemeSaving] = useState(false)
  const [themeMsg, setThemeMsg] = useState<string | null>(null)

  // ── PIN ──────────────────────────────────────────────────────────────────
  const [pinEnabled, setPinEnabled] = useState(false)
  const [autoLockMinutes, setAutoLockMinutes] = useState(5)
  const [pinSaving, setPinSaving] = useState(false)
  const [pinMsg, setPinMsg] = useState<string | null>(null)
  // Per-cashier PIN setting
  const [cashierPins, setCashierPins] = useState<Record<string, string>>({})
  const [pinSavingFor, setPinSavingFor] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([getSettings(), listUsersByRole('cashier')]).then(([s, c]) => {
      setSettings(s)
      setReceiptForm({
        restaurantNameAr: s.restaurantNameAr,
        currencySymbol: s.currencySymbol,
        phoneNumber: s.phoneNumber ?? '',
        receiptFooterAr: s.receiptFooterAr ?? '',
        taxRate: s.taxRate != null && s.taxRate > 0 ? String(s.taxRate) : '',
        defaultDeliveryFee: s.defaultDeliveryFee != null && s.defaultDeliveryFee > 0 ? String(s.defaultDeliveryFee) : '',
        maxCashierDiscountPct: s.maxCashierDiscountPct != null && s.maxCashierDiscountPct < 100 ? String(s.maxCashierDiscountPct) : ''
      })
      const color = s.primaryColor ?? DEFAULT_PRIMARY
      setSelectedColor(color)
      setCustomColor(color)
      setPinEnabled(s.pinEnabled ?? false)
      setAutoLockMinutes(s.autoLockMinutes ?? 5)
      setCashiers(c)
    })
  }, [])

  // ── Receipt save ──────────────────────────────────────────────────────────
  async function handleReceiptSave(e: FormEvent): Promise<void> {
    e.preventDefault()
    setReceiptSaving(true)
    setReceiptMsg(null)
    try {
      await updateSettings({
        restaurantNameAr: receiptForm.restaurantNameAr.trim(),
        currencySymbol: receiptForm.currencySymbol.trim(),
        phoneNumber: receiptForm.phoneNumber.trim() || undefined,
        receiptFooterAr: receiptForm.receiptFooterAr.trim() || undefined,
        taxRate: receiptForm.taxRate ? Number(receiptForm.taxRate) : 0,
        defaultDeliveryFee: receiptForm.defaultDeliveryFee ? Number(receiptForm.defaultDeliveryFee) : 0,
        maxCashierDiscountPct: receiptForm.maxCashierDiscountPct ? Number(receiptForm.maxCashierDiscountPct) : undefined
      })
      setReceiptMsg('تم حفظ إعدادات الإيصال')
    } catch { setReceiptMsg('فشل الحفظ') }
    finally { setReceiptSaving(false) }
  }

  // ── Theme save ────────────────────────────────────────────────────────────
  async function handleThemeSave(): Promise<void> {
    setThemeSaving(true)
    setThemeMsg(null)
    try {
      await updateSettings({ primaryColor: selectedColor })
      applyThemeColor(selectedColor)
      setThemeMsg('تم حفظ اللون')
    } catch { setThemeMsg('فشل الحفظ') }
    finally { setThemeSaving(false) }
  }

  function pickColor(hex: string): void {
    setSelectedColor(hex); setCustomColor(hex); applyThemeColor(hex)
  }

  // ── PIN global save ───────────────────────────────────────────────────────
  async function handlePinSettingsSave(): Promise<void> {
    setPinSaving(true)
    setPinMsg(null)
    try {
      await updateSettings({ pinEnabled, autoLockMinutes })
      setPinMsg('تم حفظ إعدادات القفل')
    } catch { setPinMsg('فشل الحفظ') }
    finally { setPinSaving(false) }
  }

  // ── Per-cashier PIN save ──────────────────────────────────────────────────
  async function saveCashierPin(cashier: AppUser): Promise<void> {
    const pin = cashierPins[cashier.id] ?? ''
    if (pin && (pin.length !== 4 || !/^\d{4}$/.test(pin))) {
      setPinMsg('رمز PIN يجب أن يكون 4 أرقام')
      return
    }
    setPinSavingFor(cashier.id)
    try {
      const pinHash = pin ? await hashPin(pin) : undefined
      await updateUserProfile(cashier.id, { pinHash })
      setCashierPins((prev) => ({ ...prev, [cashier.id]: '' }))
      setPinMsg(`تم ${pin ? 'تعيين' : 'حذف'} PIN للكاشير ${cashier.displayName}`)
    } catch (e) { setPinMsg(e instanceof Error ? e.message : 'فشل') }
    finally { setPinSavingFor(null) }
  }

  // ── Settings tab ─────────────────────────────────────────────────────────
  type SettingsTab = 'general' | 'theme' | 'pin' | 'backup' | 'shortcuts'
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const [backupLoading, setBackupLoading] = useState(false)
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false)
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('general')

  async function handleBackup(): Promise<void> {
    setBackupLoading(true)
    setBackupMsg(null)
    try {
      const result = await window.electronAPI.backupDatabase()
      setBackupMsg(result.ok ? 'تم حفظ النسخة الاحتياطية بنجاح ✓' : `فشل التصدير: ${result.error ?? ''}`)
    } catch (e) {
      setBackupMsg(`فشل: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBackupLoading(false)
    }
  }

  async function handleRestore(): Promise<void> {
    setRestoreConfirmOpen(false)
    setBackupLoading(true)
    setBackupMsg(null)
    try {
      const result = await window.electronAPI.restoreDatabase()
      if (result.ok) {
        setBackupMsg('تم استيراد قاعدة البيانات — سيتم إعادة تشغيل التطبيق الآن…')
        setTimeout(() => { void window.electronAPI.restartApp() }, 1800)
      } else {
        setBackupMsg(`فشل الاستيراد: ${result.error ?? ''}`)
      }
    } catch (e) {
      setBackupMsg(`فشل: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBackupLoading(false)
    }
  }

  // ── Backup/Restore — REQ-8 ───────────────────────────────────────────────

  if (!settings) return <p className="app-loading">جارٍ التحميل…</p>

  const settingsTabs: { key: SettingsTab; labelAr: string; icon: React.ReactNode }[] = [
    { key: 'general',   labelAr: 'عام',          icon: <MdSave /> },
    { key: 'theme',     labelAr: 'المظهر',        icon: <MdPalette /> },
    { key: 'pin',       labelAr: 'PIN والقفل',    icon: <MdLock /> },
    { key: 'backup',    labelAr: 'نسخ احتياطي',   icon: <MdBackup /> },
    { key: 'shortcuts', labelAr: 'الاختصارات',    icon: <MdKeyboard /> },
  ]

  return (
    <div className="unified-page">
      {/* ── Inner tab strip ── */}
      <div className="inner-tabs" role="tablist">
        {settingsTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={activeSettingsTab === t.key}
            className={`inner-tab${activeSettingsTab === t.key ? ' inner-tab--active' : ''}`}
            onClick={() => setActiveSettingsTab(t.key)}
          >
            {t.icon}
            {t.labelAr}
          </button>
        ))}
      </div>

      <div className="tab-content settings-tab-content">

        {/* ── General / Receipt ── */}
        {activeSettingsTab === 'general' && (
          <div className="card">
            <h2 className="card__title">إعدادات الإيصال والمطعم</h2>
            {receiptMsg && <p className={`form-message ${receiptMsg.includes('فشل') ? 'form-message--error' : 'form-message--ok'}`}>{receiptMsg}</p>}
            <form onSubmit={(e) => void handleReceiptSave(e)}>
              <div className="settings-form-grid">
                <label className="field">
                  <span>اسم المطعم</span>
                  <input value={receiptForm.restaurantNameAr} onChange={(e) => setReceiptForm((f) => ({ ...f, restaurantNameAr: e.target.value }))} required />
                </label>
                <label className="field">
                  <span>رمز العملة</span>
                  <input value={receiptForm.currencySymbol} onChange={(e) => setReceiptForm((f) => ({ ...f, currencySymbol: e.target.value }))} placeholder="ج.م" required />
                </label>
                <label className="field">
                  <span>رقم الهاتف</span>
                  <input value={receiptForm.phoneNumber} onChange={(e) => setReceiptForm((f) => ({ ...f, phoneNumber: e.target.value }))} placeholder="01xxxxxxxxx" dir="ltr" />
                </label>
                <label className="field settings-form-grid__full">
                  <span>تذييل الإيصال</span>
                  <textarea value={receiptForm.receiptFooterAr} onChange={(e) => setReceiptForm((f) => ({ ...f, receiptFooterAr: e.target.value }))} placeholder="شكراً لزيارتكم…" rows={2} />
                </label>
                <label className="field">
                  <span>ضريبة القيمة المضافة % (0 = بدون ضريبة)</span>
                  <input type="number" min="0" max="100" step="0.1" value={receiptForm.taxRate} onChange={(e) => setReceiptForm((f) => ({ ...f, taxRate: e.target.value }))} placeholder="0" />
                </label>
                <label className="field">
                  <span>رسوم التوصيل الافتراضية</span>
                  <input type="number" min="0" step="0.01" value={receiptForm.defaultDeliveryFee} onChange={(e) => setReceiptForm((f) => ({ ...f, defaultDeliveryFee: e.target.value }))} placeholder="0.00" />
                </label>
                <label className="field">
                  <span>الحد الأقصى لخصم الكاشير % (فارغ = بدون حد)</span>
                  <input type="number" min="0" max="100" step="1" value={receiptForm.maxCashierDiscountPct} onChange={(e) => setReceiptForm((f) => ({ ...f, maxCashierDiscountPct: e.target.value }))} placeholder="مثال: 20" />
                </label>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn--primary" disabled={receiptSaving}>
                  <MdSave /> {receiptSaving ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Theme ── */}
        {activeSettingsTab === 'theme' && (
          <div className="card">
            <h2 className="card__title"><MdPalette style={{ verticalAlign: 'middle', marginLeft: 6 }} />ألوان التطبيق</h2>
            {themeMsg && <p className={`form-message ${themeMsg.includes('فشل') ? 'form-message--error' : 'form-message--ok'}`}>{themeMsg}</p>}
            <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', marginBottom: 16 }}>اختر اللون الرئيسي للتطبيق</p>
            <div className="color-presets">
              {COLOR_PRESETS.map((p) => (
                <button key={p.value} type="button"
                  className={`color-swatch${selectedColor === p.value ? ' color-swatch--active' : ''}`}
                  style={{ '--swatch-color': p.value } as React.CSSProperties}
                  onClick={() => pickColor(p.value)} title={p.label} aria-label={p.label} />
              ))}
            </div>
            <div className="field" style={{ marginTop: 16 }}>
              <span>لون مخصص</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="color" value={customColor}
                  onChange={(e) => { setCustomColor(e.target.value); pickColor(e.target.value) }}
                  style={{ width: 48, height: 40, padding: 2, border: '2px solid var(--color-border)', cursor: 'pointer' }} />
                <span style={{ fontSize: '0.85rem', color: 'var(--color-muted)', fontFamily: 'monospace' }}>{selectedColor}</span>
              </div>
            </div>
            <div className="theme-preview">
              <div className="theme-preview__label">معاينة</div>
              <div className="theme-preview__bar" style={{ background: selectedColor }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button type="button" className="btn btn--primary btn--sm" style={{ pointerEvents: 'none' }}>زر رئيسي</button>
                <button type="button" className="btn btn--secondary btn--sm" style={{ pointerEvents: 'none' }}>ثانوي</button>
              </div>
            </div>
            <div className="form-actions" style={{ marginTop: 16 }}>
              <button type="button" className="btn btn--primary" onClick={() => void handleThemeSave()} disabled={themeSaving}>
                <MdSave /> {themeSaving ? 'جارٍ الحفظ…' : 'حفظ اللون'}
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => pickColor(DEFAULT_PRIMARY)}>إعادة الافتراضي</button>
            </div>
          </div>
        )}

        {/* ── PIN ── */}
        {activeSettingsTab === 'pin' && (
          <div className="card">
            <h2 className="card__title"><MdLock style={{ verticalAlign: 'middle', marginLeft: 6 }} />قفل الشاشة بـ PIN</h2>
            {pinMsg && <p className={`form-message ${pinMsg.includes('فشل') || pinMsg.includes('يجب') ? 'form-message--error' : 'form-message--ok'}`}>{pinMsg}</p>}
            <div className="pin-settings-row">
              <label className="pin-toggle-label">
                <input type="checkbox" className="pin-toggle-checkbox" checked={pinEnabled} onChange={(e) => setPinEnabled(e.target.checked)} />
                <span className="pin-toggle-text">تفعيل قفل PIN للكاشيرات</span>
              </label>
              <p style={{ fontSize: '0.82rem', color: 'var(--color-muted)', margin: '4px 0 0' }}>
                عند التفعيل يحتاج الكاشير إلى PIN شخصي للدخول بعد فترة الخمول
              </p>
            </div>
            <label className="field" style={{ maxWidth: 260, marginTop: 12 }}>
              <span>قفل تلقائي بعد</span>
              <select value={autoLockMinutes} onChange={(e) => setAutoLockMinutes(Number(e.target.value))}>
                {LOCK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={() => void handlePinSettingsSave()} disabled={pinSaving}>
                <MdSave /> {pinSaving ? 'جارٍ الحفظ…' : 'حفظ إعدادات القفل'}
              </button>
            </div>
            {cashiers.length > 0 && (
              <div style={{ marginTop: 24, paddingTop: 16, borderTop: '2px solid var(--color-border)' }}>
                <h3 style={{ margin: '0 0 12px', fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  تعيين PIN لكل كاشير
                </h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--color-muted)', margin: '0 0 16px' }}>
                  اترك الحقل فارغاً لحذف PIN الكاشير. رمز PIN يجب أن يكون 4 أرقام.
                </p>
                <div className="pin-cashier-list">
                  {cashiers.map((c) => (
                    <div key={c.id} className="pin-cashier-row">
                      <div className="pin-cashier-info">
                        <MdPerson aria-hidden="true" />
                        <span className="pin-cashier-name">{c.displayName}</span>
                        <span className="pin-cashier-username">@{c.username || c.email.split('@')[0]}</span>
                        {c.pinHash && <span className="pin-cashier-badge">PIN مُعيَّن ✓</span>}
                      </div>
                      <div className="pin-cashier-input-row">
                        <input
                          type="password" inputMode="numeric" maxLength={4} placeholder="----" dir="ltr"
                          value={cashierPins[c.id] ?? ''}
                          onChange={(e) => {
                            const v = e.target.value.replace(/\D/g, '').slice(0, 4)
                            setCashierPins((prev) => ({ ...prev, [c.id]: v }))
                          }}
                          className="inline-edit-input"
                          style={{ width: 80, textAlign: 'center', letterSpacing: '0.3em' }}
                        />
                        <button type="button" className="btn btn--primary btn--sm"
                          onClick={() => void saveCashierPin(c)} disabled={pinSavingFor === c.id}>
                          {pinSavingFor === c.id ? '...' : 'حفظ PIN'}
                        </button>
                        {c.pinHash && (
                          <button type="button" className="btn btn--danger btn--sm"
                            onClick={async () => {
                              await updateUserProfile(c.id, { pinHash: undefined })
                              setPinMsg(`تم حذف PIN للكاشير ${c.displayName}`)
                              setCashiers(await listUsersByRole('cashier'))
                            }}>
                            حذف PIN
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Backup ── */}
        {activeSettingsTab === 'backup' && (
          <div className="card">
            <h2 className="card__title">
              <MdBackup style={{ verticalAlign: 'middle', marginLeft: 6 }} />نسخ احتياطي واستعادة
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', marginBottom: 16 }}>
              صدّر قاعدة البيانات كاملةً إلى ملف آمن، أو استعد من نسخة سابقة.
              الاستعادة تستبدل جميع البيانات الحالية وتُعيد تشغيل التطبيق تلقائيًا.
            </p>
            {backupMsg && (
              <p className={`form-message ${backupMsg.includes('فشل') ? 'form-message--error' : 'form-message--ok'}`}>{backupMsg}</p>
            )}
            <div className="form-actions" style={{ gap: 12 }}>
              <button type="button" className="btn btn--primary" onClick={() => void handleBackup()} disabled={backupLoading}>
                <MdBackup /> {backupLoading ? 'جارٍ…' : 'تصدير قاعدة البيانات'}
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => setRestoreConfirmOpen(true)} disabled={backupLoading}>
                <MdRestorePage /> استعادة من نسخة احتياطية
              </button>
            </div>
          </div>
        )}

        {/* ── Keyboard shortcuts ── */}
        {activeSettingsTab === 'shortcuts' && <ShortcutsTab />}

      </div>{/* end .tab-content */}

      {/* ── Restore confirmation modal ── */}
      {restoreConfirmOpen && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="order-details__header">
              <h2 className="order-details__title">⚠️ تأكيد استعادة قاعدة البيانات</h2>
            </div>
            <div style={{ background: '#fef2f2', border: '2px solid #ef4444', borderRadius: 6, padding: '12px 16px', marginBottom: 20, fontSize: '0.9rem', lineHeight: 1.7 }}>
              <strong>تحذير:</strong> سيتم استبدال جميع البيانات الحالية (الطلبات، المخزون، الإعدادات)
              بالبيانات الموجودة في ملف النسخة الاحتياطية. هذه العملية لا يمكن التراجع عنها.
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn--danger" onClick={() => void handleRestore()}>نعم، استعد وأعد التشغيل</button>
              <button type="button" className="btn btn--secondary" onClick={() => setRestoreConfirmOpen(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
