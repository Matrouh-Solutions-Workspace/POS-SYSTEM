import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

interface LicensePayload {
  schema: 'abdokofta.license.v1'
  licenseId: string
  customerName?: string
  storeName?: string
  appId: string
  hwid: string
  features?: string[]
  issuedAt: number
  expiresAt?: number
}

interface ActivationRow {
  license_id: string
  app_id: string
  app_version: string | null
  hwid: string
  machine_platform: string | null
  machine_hostname: string | null
  customer_name: string | null
  store_name: string | null
  issued_at: string
  expires_at: string | null
  created_at: string
}

interface Stats {
  totalActivations: number
  issuedToday: number
  uniqueDevices: number
  totalEvents: number
}

function App(): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [activationRequestText, setActivationRequestText] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [storeName, setStoreName] = useState('')
  const [days, setDays] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [licenseText, setLicenseText] = useState('')
  const [licenseFileName, setLicenseFileName] = useState('license.dat')
  const [payload, setPayload] = useState<LicensePayload | null>(null)
  const [activations, setActivations] = useState<ActivationRow[]>([])
  const [stats, setStats] = useState<Stats | null>(null)

  const parsedRequest = useMemo(() => {
    if (!activationRequestText.trim()) return null
    try {
      return JSON.parse(activationRequestText) as {
        schema?: string
        appId?: string
        appVersion?: string
        hwid?: string
        machine?: { platform?: string; hostname?: string }
        createdAt?: number
      }
    } catch {
      return null
    }
  }, [activationRequestText])

  async function readActivationFile(file: File | null): Promise<void> {
    if (!file) return
    setActivationRequestText(await file.text())
    setMessage('')
  }

  async function issue(): Promise<void> {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/issue-license', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          password,
          activationRequestText,
          customerName,
          storeName,
          days,
          features: ['offline-pos']
        })
      })
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error(result.error || 'License generation failed')
      setLicenseText(result.licenseText)
      setLicenseFileName(result.fileName || 'license.dat')
      setPayload(result.license.payload)
      setMessage('تم إصدار الرخصة بنجاح.')
      await loadActivations()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'حدث خطأ غير متوقع')
    } finally {
      setBusy(false)
    }
  }

  async function loadActivations(): Promise<void> {
    if (!password) return
    const response = await fetch('/api/activations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password })
    })
    const result = await response.json()
    if (!response.ok || !result.ok) throw new Error(result.error || 'Failed to load activations')
    setActivations(result.activations)
    setStats(result.stats)
  }

  function downloadLicense(): void {
    if (!licenseText) return
    const blob = new Blob([licenseText], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = licenseFileName
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <span className="eyebrow">SHIFT POS</span>
          <h1>License Activation</h1>
          <p>ارفع ملف طلب التفعيل، سجل بيانات العميل، وطلع ملف الرخصة الموقّع مباشرة.</p>
        </div>
        <div className="status-pill">Vercel + Supabase Ready</div>
      </section>

      <section className="grid">
        <form className="panel" onSubmit={(event) => { event.preventDefault(); void issue() }}>
          <div className="panel-title">
            <h2>إصدار رخصة</h2>
            <span>activation_request.dat</span>
          </div>

          <label>
            كلمة مرور الإدارة
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          <label>
            ملف طلب التفعيل
            <input
              type="file"
              accept=".dat,.json,application/json,text/plain"
              onChange={(event) => void readActivationFile(event.target.files?.[0] ?? null)}
              required={!activationRequestText}
            />
          </label>

          <div className="two">
            <label>
              اسم العميل
              <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
            </label>
            <label>
              اسم المطعم/الفرع
              <input value={storeName} onChange={(event) => setStoreName(event.target.value)} />
            </label>
          </div>

          <label>
            مدة الرخصة بالأيام
            <input
              type="number"
              min="1"
              placeholder="اتركها فارغة لرخصة غير محددة المدة"
              value={days}
              onChange={(event) => setDays(event.target.value)}
            />
          </label>

          {parsedRequest && (
            <div className="request-card">
              <strong>{parsedRequest.machine?.hostname || 'Unknown device'}</strong>
              <span>{parsedRequest.appId} · {parsedRequest.appVersion || 'no version'}</span>
              <code>{parsedRequest.hwid}</code>
            </div>
          )}

          <button className="primary" disabled={busy || !password || !activationRequestText}>
            {busy ? 'جاري الإصدار...' : 'إصدار الرخصة'}
          </button>

          {message && <p className="message">{message}</p>}
        </form>

        <section className="panel">
          <div className="panel-title">
            <h2>ملف الرخصة</h2>
            <span>license.dat</span>
          </div>

          {payload ? (
            <div className="license-summary">
              <div>
                <span>License ID</span>
                <strong>{payload.licenseId}</strong>
              </div>
              <div>
                <span>Customer</span>
                <strong>{payload.customerName || '-'}</strong>
              </div>
              <div>
                <span>Store</span>
                <strong>{payload.storeName || '-'}</strong>
              </div>
              <div>
                <span>Expires</span>
                <strong>{payload.expiresAt ? new Date(payload.expiresAt).toLocaleDateString() : 'No expiry'}</strong>
              </div>
            </div>
          ) : (
            <div className="empty">لم يتم إصدار رخصة بعد.</div>
          )}

          <textarea
            className="license-output"
            readOnly
            value={licenseText}
            placeholder="سيظهر محتوى license.dat هنا بعد الإصدار"
          />

          <button className="secondary" disabled={!licenseText} onClick={downloadLicense}>
            تحميل license.dat
          </button>
        </section>
      </section>

      <section className="panel wide">
        <div className="panel-title">
          <h2>متابعة التفعيلات</h2>
          <button className="ghost" onClick={() => void loadActivations()} disabled={!password}>
            تحديث
          </button>
        </div>

        {stats && (
          <div className="stats">
            <Metric label="كل التفعيلات" value={stats.totalActivations} />
            <Metric label="اليوم" value={stats.issuedToday} />
            <Metric label="أجهزة مختلفة" value={stats.uniqueDevices} />
            <Metric label="أحداث مسجلة" value={stats.totalEvents} />
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>العميل</th>
                <th>المطعم</th>
                <th>الجهاز</th>
                <th>الإصدار</th>
                <th>التاريخ</th>
                <th>الانتهاء</th>
              </tr>
            </thead>
            <tbody>
              {activations.map((row) => (
                <tr key={row.license_id}>
                  <td>{row.customer_name || '-'}</td>
                  <td>{row.store_name || '-'}</td>
                  <td>
                    <strong>{row.machine_hostname || '-'}</strong>
                    <small>{row.hwid.slice(0, 16)}...</small>
                  </td>
                  <td>{row.app_version || '-'}</td>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td>{row.expires_at ? new Date(row.expires_at).toLocaleDateString() : 'غير محدد'}</td>
                </tr>
              ))}
              {activations.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-cell">لا توجد بيانات معروضة.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
