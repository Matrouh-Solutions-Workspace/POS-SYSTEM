import { useEffect, useState } from 'react'
import { useSyncStore, type SyncStatus } from './sync-store'

const LABELS: Record<SyncStatus, string> = {
  idle: 'محفوظ محليًا',
  uploading: 'جاري الرفع',
  upload_error: 'خطأ في الرفع'
}

const CLASS: Record<SyncStatus, string> = {
  idle: 'sync--online',
  uploading: 'sync--syncing',
  upload_error: 'sync--offline'
}

type NetworkBadgeState =
  | { mode: 'side'; connected: boolean; side?: { masterUrl?: string }; error?: string }
  | { mode: 'local'; master?: { running?: boolean; port?: number } }
  | null

export function SyncStatusBadge(): React.ReactElement {
  const status = useSyncStore((s) => s.status)
  const pendingUpload = useSyncStore((s) => s.pendingUpload)
  const progress = useSyncStore((s) => s.syncProgress)
  const message = useSyncStore((s) => s.syncMessage)
  const [network, setNetwork] = useState<NetworkBadgeState>(null)

  useEffect(() => {
    let disposed = false
    async function refresh(): Promise<void> {
      const next = await window.electronAPI.getNetworkStatus().catch(() => null)
      if (!disposed) setNetwork(next as NetworkBadgeState)
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 5000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [])

  if (network?.mode === 'side') {
    const label = network.connected
      ? `متصل بالماستر${network.side?.masterUrl ? ` - ${network.side.masterUrl}` : ''}`
      : `غير متصل بالماستر${network.error ? ` - ${network.error}` : ''}`
    return (
      <span className={`sync-badge ${network.connected ? 'sync--online' : 'sync--offline'}`} title={label}>
        <span className="sync-badge__dot" />
        {network.connected ? 'متصل بالماستر' : 'غير متصل بالماستر'}
      </span>
    )
  }

  if (network?.mode === 'local' && network.master?.running) {
    const label = `ماستر LAN يعمل على ${network.master.port ?? ''}`
    return (
      <span className="sync-badge sync--online" title={label}>
        <span className="sync-badge__dot" />
        ماستر LAN متاح
      </span>
    )
  }

  const progressLabel = progress == null ? null : `${Math.round(progress)}%`
  const pendingLabel = pendingUpload > 0 && status === 'idle' ? ` (${pendingUpload} في الانتظار)` : ''
  const label = progressLabel
    ? `${message ?? LABELS[status]} ${progressLabel}`
    : `${LABELS[status]}${pendingLabel}`

  return (
    <span className={`sync-badge ${CLASS[status]}`} title={label}>
      <span className="sync-badge__dot" />
      {label}
    </span>
  )
}
