import { useState, useEffect } from 'react'
import type { AppSettings } from '@shared/types'
import { updateSettings } from '@renderer/features/orders/order-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { applyThemeColor, DEFAULT_PRIMARY } from '@renderer/features/theme/theme-store'
import { MdPalette, MdSave } from 'react-icons/md'

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

export function ThemeTab({ settings, onSettingsSaved }: { settings: AppSettings, onSettingsSaved: (s: AppSettings) => void }): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [selectedColor, setSelectedColor] = useState(DEFAULT_PRIMARY)
  const [customColor, setCustomColor] = useState(DEFAULT_PRIMARY)
  const [themeSaving, setThemeSaving] = useState(false)
  const [themeMsg, setThemeMsg] = useState<string | null>(null)

  useEffect(() => {
    const color = settings.primaryColor ?? DEFAULT_PRIMARY
    setSelectedColor(color)
    setCustomColor(color)
  }, [settings])

  async function handleThemeSave(): Promise<void> {
    setThemeSaving(true)
    setThemeMsg(null)
    try {
      await updateSettings({ primaryColor: selectedColor }, user)
      applyThemeColor(selectedColor)
      onSettingsSaved({ ...settings, primaryColor: selectedColor, updatedAt: Date.now() })
      setThemeMsg('تم حفظ اللون')
    } catch { setThemeMsg('فشل الحفظ') }
    finally { setThemeSaving(false) }
  }

  function pickColor(hex: string): void {
    setSelectedColor(hex); setCustomColor(hex); applyThemeColor(hex)
  }

  return (
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
      <div className="field mt-16">
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
      <div className="form-actions mt-16">
        <button type="button" className="btn btn--primary" onClick={() => void handleThemeSave()} disabled={themeSaving}>
          <MdSave /> {themeSaving ? 'جارٍ الحفظ…' : 'حفظ اللون'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={() => pickColor(DEFAULT_PRIMARY)}>إعادة الافتراضي</button>
      </div>
    </div>
  )
}
