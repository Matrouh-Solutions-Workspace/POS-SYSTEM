import { useState, useEffect, useRef } from 'react'

interface LicenseActivationPageProps {
  status: {
    valid: boolean
    reason?: string
    hwid: string
    licensePath: string
  }
  onActivated: () => void
}

export function LicenseActivationPage({
  status,
  onActivated
}: LicenseActivationPageProps): React.ReactElement {
  const [message, setMessage] = useState(status.reason ?? 'التطبيق يحتاج إلى تفعيل')
  const [busy, setBusy] = useState(false)
  const [masterUrl, setMasterUrl] = useState('http://192.168.1.10:47831')
  const [deviceName, setDeviceName] = useState(() => `POS-${Math.floor(Math.random() * 900 + 100)}`)
  const [pairingCode, setPairingCode] = useState('')

  // Secret master-key activation:
  // Type the key then press Ctrl+Shift+0 — works in production.
  const keyBufferRef = useRef('')
  const bufferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      // Log every keydown so we can debug in console
      console.log('[license-key] keydown', {
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        buffer: keyBufferRef.current
      })

      // Ctrl+Enter = trigger (avoids all globalShortcut conflicts)
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'Enter') {
        e.preventDefault()
        const key = keyBufferRef.current
        keyBufferRef.current = ''
        if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current)

        console.log('[license-key] TRIGGER fired — buffer was:', JSON.stringify(key))

        if (!key) {
          console.warn('[license-key] buffer was empty — nothing to submit')
          return
        }
        void (async () => {
          setBusy(true)
          try {
            console.log('[license-key] calling activateMasterKey with:', JSON.stringify(key))
            const result = await window.electronAPI.activateMasterKey(key)
            console.log('[license-key] result:', result)
            if (result.ok) {
              setMessage('✅ تم التفعيل — جارٍ إعادة التشغيل…')
              setTimeout(onActivated, 800)
            } else {
              setMessage(`❌ ${result.error ?? 'المفتاح غير صحيح'}`)
            }
          } finally {
            setBusy(false)
          }
        })()
        return
      }

      // Skip pure modifier keys (Ctrl, Alt, Meta) but ALLOW Shift
      // because characters like @ require Shift to type
      if (e.ctrlKey || e.altKey || e.metaKey) return

      // Accumulate printable characters (single char = printable)
      if (e.key.length === 1) {
        keyBufferRef.current += e.key
        console.log('[license-key] buffer now:', JSON.stringify(keyBufferRef.current))
        // Auto-clear after 10 s of inactivity
        if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current)
        bufferTimerRef.current = setTimeout(() => {
          console.log('[license-key] buffer auto-cleared after timeout')
          keyBufferRef.current = ''
        }, 10_000)
        return
      }

      // Backspace support
      if (e.key === 'Backspace') {
        keyBufferRef.current = keyBufferRef.current.slice(0, -1)
        console.log('[license-key] backspace — buffer now:', JSON.stringify(keyBufferRef.current))
      }
    }

    console.log('[license-key] keyboard listener attached')
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      console.log('[license-key] keyboard listener removed')
      window.removeEventListener('keydown', handleKeyDown)
      if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current)
    }
  }, [onActivated])

  async function createRequest(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.electronAPI.createActivationRequest()
      setMessage(result.ok && result.path
        ? `تم حفظ طلب التفعيل: ${result.path}`
        : result.error ?? 'لم يتم إنشاء طلب التفعيل')
    } finally {
      setBusy(false)
    }
  }

  async function importLicense(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.electronAPI.importLicense()
      if (result.ok && result.status?.valid) {
        setMessage('تم التفعيل بنجاح')
        onActivated()
      } else {
        setMessage(result.status?.reason ?? result.error ?? 'ملف الرخصة غير صالح')
      }
    } finally {
      setBusy(false)
    }
  }

  async function pairSideDevice(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.electronAPI.pairSideDevice({
        masterUrl,
        deviceName,
        code: pairingCode
      })
      if (result.ok) {
        setMessage('تم ربط الجهاز بالماستر - جار إعادة التشغيل...')
        setTimeout(onActivated, 800)
      } else {
        setMessage(result.error ?? 'فشل ربط الجهاز بالماستر')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="license-page" dir="rtl">
      <section className="license-panel">
        <h1>تفعيل التطبيق</h1>
        <p className="license-panel__message">{message}</p>
        <div className="license-panel__meta">
          <span>معرّف الجهاز</span>
          <code dir="ltr">{status.hwid}</code>
        </div>
        <div className="license-panel__meta">
          <span>مكان الرخصة</span>
          <code dir="ltr">{status.licensePath}</code>
        </div>
        <div className="license-panel__actions">
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void createRequest()}>
            إنشاء activation_request.dat
          </button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void importLicense()}>
            استيراد license.dat
          </button>
        </div>
        <div className="license-panel__meta">
          <span>جهاز جانبي</span>
          <code dir="rtl">اربط هذا الجهاز بماستر مرخص</code>
        </div>
        <div className="settings-form-grid" style={{ marginTop: 12 }}>
          <label className="field">
            <span>Master IP / Port</span>
            <input dir="ltr" value={masterUrl} onChange={(e) => setMasterUrl(e.target.value)} placeholder="http://192.168.1.10:47831" />
          </label>
          <label className="field">
            <span>اسم الجهاز</span>
            <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
          </label>
          <label className="field">
            <span>كود الربط</span>
            <input dir="ltr" value={pairingCode} onChange={(e) => setPairingCode(e.target.value)} placeholder="123456" />
          </label>
        </div>
        <div className="license-panel__actions">
          <button type="button" className="btn btn--secondary" disabled={busy || !masterUrl || !pairingCode} onClick={() => void pairSideDevice()}>
            ربط بماستر
          </button>
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void window.electronAPI.clearSideConnection().then(onActivated)}>
            مسح ربط الجهاز
          </button>
        </div>
      </section>
    </main>
  )
}
