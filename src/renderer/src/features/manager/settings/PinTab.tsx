import { useState, useEffect } from 'react'
import type { AppSettings, AppUser } from '@shared/types'
import { updateSettings } from '@renderer/features/orders/order-service'
import { listUsersByRole, updateUserProfile } from '@renderer/features/auth/auth-service'
import { hashPin } from '@renderer/features/auth/pin-store'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { MdLock, MdPerson, MdSave } from 'react-icons/md'

const LOCK_OPTIONS = [
  { value: 0,   label: 'لا يُقفل تلقائياً' },
  { value: 1,   label: 'دقيقة واحدة' },
  { value: 5,   label: '٥ دقائق' },
  { value: 10,  label: '١٠ دقائق' },
  { value: 15,  label: '١٥ دقيقة' },
  { value: 30,  label: '٣٠ دقيقة' },
  { value: 60,  label: 'ساعة' }
]

export function PinTab({ settings, onSettingsSaved }: { settings: AppSettings, onSettingsSaved: (s: AppSettings) => void }): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [pinEnabled, setPinEnabled] = useState(false)
  const [autoLockMinutes, setAutoLockMinutes] = useState(5)
  const [pinSaving, setPinSaving] = useState(false)
  const [pinMsg, setPinMsg] = useState<string | null>(null)
  
  const [cashiers, setCashiers] = useState<AppUser[]>([])
  const [cashierPins, setCashierPins] = useState<Record<string, string>>({})
  const [pinSavingFor, setPinSavingFor] = useState<string | null>(null)

  useEffect(() => {
    setPinEnabled(settings.pinEnabled ?? false)
    setAutoLockMinutes(settings.autoLockMinutes ?? 5)
    void listUsersByRole('cashier').then(setCashiers)
  }, [settings])

  async function handlePinSettingsSave(): Promise<void> {
    setPinSaving(true)
    setPinMsg(null)
    try {
      await updateSettings({ pinEnabled, autoLockMinutes }, user)
      onSettingsSaved({ ...settings, pinEnabled, autoLockMinutes, updatedAt: Date.now() })
      setPinMsg('تم حفظ إعدادات القفل')
    } catch { setPinMsg('فشل الحفظ') }
    finally { setPinSaving(false) }
  }

  async function saveCashierPin(cashier: AppUser): Promise<void> {
    const pin = cashierPins[cashier.id] ?? ''
    if (pin && (pin.length !== 4 || !/^\d{4}$/.test(pin))) {
      setPinMsg('رمز PIN يجب أن يكون 4 أرقام')
      return
    }
    setPinSavingFor(cashier.id)
    try {
      const pinHash = pin ? await hashPin(pin) : undefined
      await updateUserProfile(cashier.id, { pinHash }, user)
      setCashierPins((prev) => ({ ...prev, [cashier.id]: '' }))
      setPinMsg(`تم ${pin ? 'تعيين' : 'حذف'} PIN للكاشير ${cashier.displayName}`)
      setCashiers(await listUsersByRole('cashier'))
    } catch (e) { setPinMsg(e instanceof Error ? e.message : 'فشل') }
    finally { setPinSavingFor(null) }
  }

  return (
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
                        await updateUserProfile(c.id, { pinHash: undefined }, user)
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
  )
}
