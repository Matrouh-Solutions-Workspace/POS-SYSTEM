/**
 * Background HTTP API upload service.
 *
 * The Electron main process validates master mode and the local license,
 * then sends the queued batch to the configured API endpoint.
 */

import { useSyncStore } from './sync-store'

let running = false

export async function uploadOutboxToApi(): Promise<{
  uploaded: number
  deleted: number
  failed: number
}> {
  if (running) return { uploaded: 0, deleted: 0, failed: 0 }
  running = true

  const result = { uploaded: 0, deleted: 0, failed: 0 }

  try {
    const store = useSyncStore.getState()

    store.setSyncProgress(0, 'جاري المزامنة مع الخادم')
    const syncResult = await window.electronAPI.pushApiSync()
    if (syncResult.skipped === 'disabled' || syncResult.skipped === 'not_master' || syncResult.skipped === 'empty') {
      store.setSyncProgress(null, null)
      return result
    }
    result.uploaded = syncResult.uploaded
    result.failed = syncResult.failed || (syncResult.ok ? 0 : Math.max(1, syncResult.pending))

    const { count } = await window.electronAPI.outboxCountPending()
    store.setPendingUpload(count)

    store.setSyncProgress(
      100,
      syncResult.ok ? 'تمت المزامنة مع الخادم' : syncResult.error ?? 'اكتملت المزامنة مع أخطاء'
    )
    window.setTimeout(() => {
      useSyncStore.getState().setSyncProgress(null, null)
    }, 1400)
  } finally {
    running = false
  }

  return result
}

/** Returns the number of pending outbox entries waiting to upload */
export async function getPendingUploadCount(): Promise<number> {
  const { count } = await window.electronAPI.outboxCountPending()
  return count
}
