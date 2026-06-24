/**
 * Sync store — tracks background HTTP API upload status.
 *
 * SQLite is always the primary database; this store only reflects
 * the background upload state to the configured API.
 */
import { create } from 'zustand'

export type SyncStatus = 'idle' | 'uploading' | 'upload_error'

interface SyncState {
  /** Number of documents waiting to be uploaded to the API */
  pendingUpload: number
  status: SyncStatus
  syncProgress: number | null
  syncMessage: string | null

  setPendingUpload: (count: number) => void
  setSyncProgress: (progress: number | null, message?: string | null) => void
}

export const useSyncStore = create<SyncState>((set) => ({
  pendingUpload: 0,
  status: 'idle',
  syncProgress: null,
  syncMessage: null,

  setPendingUpload: (count) => {
    set({ pendingUpload: count, status: count > 0 ? 'uploading' : 'idle' })
  },

  setSyncProgress: (progress, message = null) => {
    set({
      syncProgress: progress,
      syncMessage: message,
      status: progress != null ? 'uploading' : 'idle'
    })
  }
}))

/** Always returns false — SQLite is always available, app never goes "offline" */
export function isAppOffline(): boolean {
  return false
}

/** No-op — kept for backwards compatibility */
export async function trackWrite<T>(fn: () => Promise<T>): Promise<T> {
  return fn()
}
