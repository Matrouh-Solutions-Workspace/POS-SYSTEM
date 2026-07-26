import { useEffect, useRef, useState } from 'react'
import { MdKey, MdUploadFile, MdDevices } from 'react-icons/md'
import logoUrl from '../../../../../public/image.png'

interface LicenseActivationPageProps {
  status: {
    valid: boolean
    reason?: string
    hwid: string
    licensePath: string
  }
  onActivated: () => void
}

type ActivationStep = 'license' | 'role' | 'pair'
type ActivationMethod = 'key' | 'file'
const DEV_ACTIVATION_CODE = 'wanrltw153'

export function LicenseActivationPage({
  status,
  onActivated
}: LicenseActivationPageProps): React.ReactElement {
  const [step, setStep] = useState<ActivationStep>('license')
  const [method, setMethod] = useState<ActivationMethod>('key')
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'warn' | 'error' | 'success'>('warn')
  const [busy, setBusy] = useState(false)
  const [licenseKey, setLicenseKey] = useState('')
  const [masterUrl, setMasterUrl] = useState('http://192.168.1.10:47831')
  const [deviceName] = useState(() => `POS-${Math.floor(Math.random() * 900 + 100)}`)
  const [pairingCode, setPairingCode] = useState('')
  const hiddenCodeBuffer = useRef('')

  // Hidden dev shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.ctrlKey && e.key === 'Enter') {
        if (hiddenCodeBuffer.current.endsWith(DEV_ACTIVATION_CODE) && !busy) {
          e.preventDefault()
          void activateWithHiddenCode()
        }
        hiddenCodeBuffer.current = ''
        return
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        hiddenCodeBuffer.current =
          `${hiddenCodeBuffer.current}${e.key.toLowerCase()}`.slice(-DEV_ACTIVATION_CODE.length)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy])

  function setMsg(text: string, type: 'warn' | 'error' | 'success' = 'warn'): void {
    setMessage(text)
    setMessageType(type)
  }

  function resolvedStatus(result: { status?: unknown }): { valid?: boolean; reason?: string } {
    return (result.status ?? {}) as { valid?: boolean; reason?: string }
  }

  async function activateWithKey(): Promise<void> {
    if (!licenseKey.trim()) return
    setBusy(true)
    try {
      const result = await window.electronAPI.activateWithLicenseKey(licenseKey.trim())
      if (result.ok && resolvedStatus(result).valid) {
        setMsg('تم تفعيل الرخصة بنجاح. اختر نوع هذا الجهاز.', 'success')
        setStep('role')
      } else {
        setMsg(resolvedStatus(result).reason ?? result.error ?? 'فشل التفعيل. تحقق من المفتاح وحاول مجدداً.', 'error')
      }
    } finally { setBusy(false) }
  }

  async function createRequest(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.electronAPI.createActivationRequest()
      if (result.ok && result.path) setMsg(`تم حفظ طلب التفعيل في: ${result.path}`, 'success')
      else setMsg(result.error ?? 'لم يتم إنشاء طلب التفعيل', 'error')
    } finally { setBusy(false) }
  }

  async function importLicense(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.electronAPI.importLicense()
      if (result.ok && resolvedStatus(result).valid) {
        setMsg('تم تفعيل الرخصة بنجاح. اختر نوع هذا الجهاز.', 'success')
        setStep('role')
      } else {
        setMsg(resolvedStatus(result).reason ?? result.error ?? 'ملف الرخصة غير صالح', 'error')
      }
    } finally { setBusy(false) }
  }

  async function activateWithHiddenCode(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.electronAPI.activateWithDevCode(DEV_ACTIVATION_CODE)
      if (result.ok && resolvedStatus(result).valid) {
        setMsg('تم التفعيل (dev). اختر نوع هذا الجهاز.', 'success')
        setStep('role')
      } else {
        setMsg(resolvedStatus(result).reason ?? result.error ?? 'فشل التفعيل', 'error')
      }
    } finally { setBusy(false) }
  }

  async function chooseMaster(): Promise<void> {
    setBusy(true)
    try {
      await window.electronAPI.clearSideConnection()
      setMsg('تم اختيار هذا الجهاز كجهاز رئيسي.', 'success')
      setTimeout(onActivated, 600)
    } finally { setBusy(false) }
  }

  async function pairSideDevice(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.electronAPI.pairSideDevice({ masterUrl, deviceName, code: pairingCode })
      if (result.ok) {
        setMsg('تم ربط الجهاز بالماستر. جار فتح البرنامج...', 'success')
        setTimeout(onActivated, 600)
      } else {
        setMsg(result.error ?? 'فشل ربط الجهاز بالماستر', 'error')
      }
    } finally { setBusy(false) }
  }

  const msgClass = `license-panel__message${
    messageType === 'error' ? ' license-panel__message--error' :
    messageType === 'success' ? ' license-panel__message--success' : ''
  }`

  return (
    <main className="license-page" dir="rtl">
      <div className="license-panel">
        <div className="license-panel__bar" />
        <div className="license-panel__inner">
          <div className="license-panel__header">
            <img src={logoUrl} alt="SHIFT POS" className="license-panel__logo" />
            <h1>SHIFT POS</h1>
          </div>
          <p className="license-panel__subtitle">
            {step === 'license' && 'التطبيق يحتاج إلى تفعيل للمتابعة'}
            {step === 'role' && 'اختر نوع هذا الجهاز'}
            {step === 'pair' && 'ربط جهاز جانبي بالماستر'}
          </p>

          {message && <p className={msgClass}>{message}</p>}

          {/* ── Step: license ── */}
          {step === 'license' && (
            <>
              {/* HWID */}
              <div className="license-panel__hwid">
                <span className="license-panel__hwid-label">معرّف الجهاز</span>
                <span className="license-panel__hwid-value">{status.hwid.slice(0, 32)}…</span>
              </div>

              {/* Method tabs */}
              <div className="license-panel__tabs">
                <button
                  type="button"
                  className={`license-tab${method === 'key' ? ' license-tab--active' : ''}`}
                  onClick={() => setMethod('key')}
                >
                  <MdKey style={{ marginLeft: 6, verticalAlign: 'middle' }} />
                  مفتاح الاشتراك
                </button>
                <button
                  type="button"
                  className={`license-tab${method === 'file' ? ' license-tab--active' : ''}`}
                  onClick={() => setMethod('file')}
                >
                  <MdUploadFile style={{ marginLeft: 6, verticalAlign: 'middle' }} />
                  ملف الرخصة
                </button>
              </div>

              {/* Online key method */}
              {method === 'key' && (
                <div className="license-panel__key-form">
                  <p className="license-panel__hint">
                    أدخل مفتاح الاشتراك الذي حصلت عليه عند الشراء. سيتم التفعيل أونلاين مباشرة.
                  </p>
                  <input
                    dir="ltr"
                    className="license-key-input"
                    type="text"
                    placeholder="SHIFT-XXXX-XXXX-XXXX"
                    value={licenseKey}
                    onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void activateWithKey() }}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={20}
                  />
                  <div className="license-panel__actions">
                    <button
                      type="button"
                      className="btn btn--primary btn--lg"
                      disabled={busy || licenseKey.trim().length < 18}
                      onClick={() => void activateWithKey()}
                    >
                      {busy ? 'جاري التفعيل...' : 'تفعيل'}
                    </button>
                  </div>
                </div>
              )}

              {/* File method */}
              {method === 'file' && (
                <>
                  <p className="license-panel__hint">
                    أنشئ ملف طلب التفعيل وأرسله لمزود الخدمة، ثم استورد ملف الرخصة الذي ستحصل عليه.
                  </p>
                  <div className="license-panel__actions">
                    <button
                      type="button"
                      className="btn btn--primary btn--lg"
                      disabled={busy}
                      onClick={() => void importLicense()}
                    >
                      {busy ? 'جاري الاستيراد...' : 'استيراد license.dat'}
                    </button>
                    <div className="license-panel__divider">أو</div>
                    <button
                      type="button"
                      className="btn btn--secondary btn--lg"
                      disabled={busy}
                      onClick={() => void createRequest()}
                    >
                      إنشاء activation_request.dat
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── Step: role ── */}
          {step === 'role' && (
            <>
              <div className="license-panel__meta">
                <span>ملاحظة</span>
                <code>كل جهاز يحتاج رخصته الخاصة. الجهاز الجانبي يتم ربطه بالماستر بعد التفعيل.</code>
              </div>
              <div className="license-panel__actions">
                <button
                  type="button"
                  className="btn btn--primary btn--lg"
                  disabled={busy}
                  onClick={() => void chooseMaster()}
                >
                  <MdDevices style={{ marginLeft: 8 }} />
                  {busy ? 'جاري...' : 'جهاز ماستر (رئيسي)'}
                </button>
                <div className="license-panel__divider">أو</div>
                <button
                  type="button"
                  className="btn btn--secondary btn--lg"
                  disabled={busy}
                  onClick={() => setStep('pair')}
                >
                  جهاز جانبي
                </button>
              </div>
            </>
          )}

          {/* ── Step: pair ── */}
          {step === 'pair' && (
            <>
              <div className="settings-form-grid grid-cols-1" style={{ marginBottom: 16 }}>
                <label className="field">
                  <span>Master IP / Port</span>
                  <input dir="ltr" value={masterUrl} onChange={(e) => setMasterUrl(e.target.value)} placeholder="http://192.168.1.10:47831" />
                </label>
                <label className="field">
                  <span>اسم الجهاز</span>
                  <input value={deviceName} readOnly />
                </label>
                <label className="field">
                  <span>كود الربط</span>
                  <input dir="ltr" value={pairingCode} onChange={(e) => setPairingCode(e.target.value)} placeholder="123456" />
                </label>
              </div>
              <div className="license-panel__actions">
                <button
                  type="button"
                  className="btn btn--primary btn--lg"
                  disabled={busy || !masterUrl || !pairingCode}
                  onClick={() => void pairSideDevice()}
                >
                  {busy ? 'جاري الربط...' : 'ربط بالماستر'}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--lg"
                  disabled={busy}
                  onClick={() => setStep('role')}
                >
                  رجوع
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </main>
  )
}
