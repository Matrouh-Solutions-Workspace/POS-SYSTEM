import { useState } from 'react'

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

export function LicenseActivationPage({
  status,
  onActivated
}: LicenseActivationPageProps): React.ReactElement {
  const [step, setStep] = useState<ActivationStep>('license')
  const [message, setMessage] = useState(status.reason ?? 'التطبيق يحتاج إلى تفعيل')
  const [busy, setBusy] = useState(false)
  const [masterUrl, setMasterUrl] = useState('http://192.168.1.10:47831')
  const [deviceName, setDeviceName] = useState(() => `POS-${Math.floor(Math.random() * 900 + 100)}`)
  const [pairingCode, setPairingCode] = useState('')

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
        setMessage('تم تفعيل الرخصة. اختر نوع هذا الجهاز.')
        setStep('role')
      } else {
        setMessage(result.status?.reason ?? result.error ?? 'ملف الرخصة غير صالح')
      }
    } finally {
      setBusy(false)
    }
  }

  async function chooseMaster(): Promise<void> {
    setBusy(true)
    try {
      await window.electronAPI.clearSideConnection()
      setMessage('تم اختيار هذا الجهاز كجهاز رئيسي.')
      setTimeout(onActivated, 500)
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
        setMessage('تم ربط الجهاز بالماستر. جار فتح البرنامج...')
        setTimeout(onActivated, 500)
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

        {step === 'license' && (
          <>
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
          </>
        )}

        {step === 'role' && (
          <>
            <div className="license-panel__meta">
              <span>نوع الجهاز</span>
              <code dir="rtl">كل جهاز يحتاج رخصته الخاصة. الجهاز الجانبي يتم ربطه بالماستر بعد التفعيل.</code>
            </div>
            <div className="license-panel__actions">
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void chooseMaster()}>
                جهاز ماستر
              </button>
              <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => setStep('pair')}>
                جهاز جانبي
              </button>
            </div>
          </>
        )}

        {step === 'pair' && (
          <>
            <div className="license-panel__meta">
              <span>ربط جهاز جانبي</span>
              <code dir="rtl">اكتب عنوان الماستر وكود الربط الظاهر في إعدادات الماستر.</code>
            </div>
            <div className="settings-form-grid mt-12">
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
              <button type="button" className="btn btn--primary" disabled={busy || !masterUrl || !pairingCode} onClick={() => void pairSideDevice()}>
                ربط بالماستر
              </button>
              <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => setStep('role')}>
                رجوع
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  )
}
