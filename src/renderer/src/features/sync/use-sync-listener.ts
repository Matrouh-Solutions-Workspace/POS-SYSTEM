/**
 * Background HTTP API sync listener.
 *
 * Polls the outbox every 30 s and on network-online events.
 * Upload is performed through IPC by the Electron main process.
 */
import { useEffect } from 'react'
import { useSyncStore } from './sync-store'
import { getPendingUploadCount, uploadOutboxToApi } from './outbox-uploader'
import { getSettings } from '@renderer/features/orders/order-service'

export function useSyncListener(): void {
  const setPendingUpload = useSyncStore((s) => s.setPendingUpload)

  useEffect(() => {
    let disposed = false

    async function tryUpload(): Promise<void> {
      if (disposed) return

      const settings = await getSettings().catch(() => null)
      if (settings?.networkMode !== 'master') {
        setPendingUpload(0)
        return
      }

      // Refresh pending count in the store (drives the UI badge)
      let count = 0
      try {
        count = await getPendingUploadCount()
        setPendingUpload(count)
      } catch {
        return
      }

      // Nothing to upload — skip silently
      if (count === 0) return

      // Only attempt if the browser reports online
      if (!navigator.onLine) return

      try {
        await uploadOutboxToApi()
        const remaining = await getPendingUploadCount()
        setPendingUpload(remaining)
      } catch (e) {
        console.warn('[sync] background upload failed', e)
      }
    }

    // Run once on mount
    void tryUpload()

    // Re-run when network comes back
    const onOnline = (): void => { void tryUpload() }
    window.addEventListener('online', onOnline)

    // Poll every 30 s
    const timer = window.setInterval(() => { void tryUpload() }, 30_000)

    return () => {
      disposed = true
      window.removeEventListener('online', onOnline)
      window.clearInterval(timer)
    }
  }, [setPendingUpload])
}
