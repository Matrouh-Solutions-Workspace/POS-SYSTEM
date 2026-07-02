import { useState, useEffect } from 'react'
import type { AppSettings } from '@shared/types'
import { updateSettings } from '@renderer/features/orders/order-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { MdDevices, MdSave } from 'react-icons/md'

export function NetworkTab({ settings, onSettingsSaved }: { settings: AppSettings, onSettingsSaved: (s: AppSettings) => void }): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [networkMode, setNetworkMode] = useState<'standalone' | 'master' | 'side'>('standalone')
  const [masterServerPort, setMasterServerPort] = useState(47831)
  const [receiptPrintRoute, setReceiptPrintRoute] = useState<'side' | 'master'>('side')
  const [networkMsg, setNetworkMsg] = useState<string | null>(null)
  const [networkSaving, setNetworkSaving] = useState(false)
  const [masterStatus, setMasterStatus] = useState<{
    running?: boolean
    port?: number
    addresses?: string[]
    pairingCode?: string
    pairedDevices?: Array<{ id: string; name: string; pairedAt: number; lastSeenAt?: number }>
    lastError?: string
  } | null>(null)

  useEffect(() => {
    setNetworkMode(settings.networkMode ?? 'standalone')
    setMasterServerPort(settings.masterServerPort ?? 47831)
    setReceiptPrintRoute(settings.receiptPrintRoute === 'master' ? 'master' : 'side')
  }, [settings])

  useEffect(() => {
    let disposed = false
    async function refresh(): Promise<void> {
      const status = await window.electronAPI.getMasterNetworkStatus().catch(() => null)
      if (!disposed) setMasterStatus(status as typeof masterStatus)
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 5000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [])

  async function handleNetworkSave(): Promise<void> {
    setNetworkSaving(true)
    setNetworkMsg(null)
    try {
      await updateSettings({
        networkMode,
        masterServerPort,
        sideDisconnectPolicy: 'block_actions',
        receiptPrintRoute
      }, user)
      const status = await window.electronAPI.refreshMasterServer()
      setMasterStatus(status as typeof masterStatus)
      onSettingsSaved({ ...settings, networkMode, masterServerPort, sideDisconnectPolicy: 'block_actions', receiptPrintRoute, updatedAt: Date.now() })
      setNetworkMsg('تم حفظ إعدادات الشبكة')
    } catch (e) {
      setNetworkMsg(e instanceof Error ? e.message : 'فشل حفظ إعدادات الشبكة')
    } finally {
      setNetworkSaving(false)
    }
  }

  return (
    <div className="card">
      <h2 className="card__title"><MdDevices style={{ verticalAlign: 'middle', marginLeft: 6 }} />أجهزة الشبكة</h2>
      {networkMsg && <p className={`form-message ${networkMsg.includes('فشل') ? 'form-message--error' : 'form-message--ok'}`}>{networkMsg}</p>}
      <div className="settings-form-grid">
        <label className="field">
          <span>وضع الجهاز</span>
          <select value={networkMode} onChange={(e) => setNetworkMode(e.target.value as typeof networkMode)}>
            <option value="standalone">جهاز منفرد</option>
            <option value="master">ماستر</option>
          </select>
        </label>
        <label className="field">
          <span>منفذ الماستر</span>
          <input type="number" min="1024" max="65535" value={masterServerPort} onChange={(e) => setMasterServerPort(Number(e.target.value) || 47831)} />
        </label>
        <label className="field">
          <span>طباعة الفاتورة</span>
          <select value={receiptPrintRoute} onChange={(e) => setReceiptPrintRoute(e.target.value as typeof receiptPrintRoute)}>
            <option value="side">على الجهاز الجانبي</option>
            <option value="master">على الماستر</option>
          </select>
        </label>
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn--primary" onClick={() => void handleNetworkSave()} disabled={networkSaving}>
          <MdSave /> {networkSaving ? 'جارٍ...' : 'حفظ الشبكة'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={async () => setMasterStatus(await window.electronAPI.getMasterNetworkStatus() as typeof masterStatus)}>
          تحديث الحالة
        </button>
        <button type="button" className="btn btn--secondary" onClick={async () => { await window.electronAPI.resetMasterPairingCode(); setMasterStatus(await window.electronAPI.getMasterNetworkStatus() as typeof masterStatus) }}>
          كود ربط جديد
        </button>
      </div>
      <div className="license-panel__meta mt-16">
        <span>الحالة</span>
        <code dir="ltr">{masterStatus?.running ? `يعمل على ${masterStatus.port}` : 'متوقف'}</code>
      </div>
      <div className="license-panel__meta">
        <span>عناوين IP</span>
        <code dir="ltr">{masterStatus?.addresses?.join(', ') || '-'}</code>
      </div>
      <div className="license-panel__meta">
        <span>كود الربط</span>
        <code dir="ltr">{masterStatus?.pairingCode ?? '-'}</code>
      </div>
      {masterStatus?.lastError && <p className="form-message form-message--error">{masterStatus.lastError}</p>}
      <table className="data-table mt-16">
        <thead>
          <tr><th>الجهاز</th><th>آخر اتصال</th><th>إجراءات</th></tr>
        </thead>
        <tbody>
          {(masterStatus?.pairedDevices ?? []).map((device) => (
            <tr key={device.id}>
              <td>{device.name}</td>
              <td>{device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString('ar-EG') : '-'}</td>
              <td>
                <button type="button" className="btn btn--danger btn--sm" onClick={async () => { await window.electronAPI.revokeMasterDevice(device.id); setMasterStatus(await window.electronAPI.getMasterNetworkStatus() as typeof masterStatus) }}>
                  إلغاء
                </button>
              </td>
            </tr>
          ))}
          {(masterStatus?.pairedDevices ?? []).length === 0 && (
            <tr><td colSpan={3}>لا توجد أجهزة مرتبطة</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
