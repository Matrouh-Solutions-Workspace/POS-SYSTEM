export interface ElectronAPI {
  // Receipt printing
  printReceipt: (html: string) => Promise<boolean>
  // Auth admin
  deleteAuthUser: (uid: string) => Promise<{ ok: boolean; error?: string }>
  resetAuthUserPassword: (uid: string, newPassword: string) => Promise<{ ok: boolean; error?: string }>
  ensureAuthUser: (params: {
    uid: string
    email: string
    password: string
    displayName: string
  }) => Promise<{ ok: boolean; error?: string }>
  getAdminDocument: (
    collectionName: string,
    documentId: string
  ) => Promise<{ ok: boolean; data?: unknown | null; error?: string }>
  setAdminDocument: (
    collectionName: string,
    documentId: string,
    data: unknown
  ) => Promise<{ ok: boolean; error?: string }>

  // App version & control
  getAppVersion: () => Promise<string>
  restartApp: () => Promise<void>
  getLicenseStatus: () => Promise<{
    valid: boolean
    reason?: string
    hwid: string
    licensePath: string
    license?: {
      licenseId: string
      customerName?: string
      storeName?: string
      issuedAt: number
      expiresAt?: number
    }
  }>
  createActivationRequest: () => Promise<{ ok: boolean; path?: string; error?: string }>
  importLicense: () => Promise<{
    ok: boolean
    status?: { valid: boolean; reason?: string }
    error?: string
  }>
  activateMasterKey: (key: string) => Promise<{ ok: boolean; error?: string }>
  getNetworkStatus: () => Promise<unknown>
  pairSideDevice: (params: { masterUrl: string; deviceName: string; code: string }) => Promise<{ ok: boolean; error?: string }>
  clearSideConnection: () => Promise<{ ok: boolean }>
  getMasterNetworkStatus: () => Promise<unknown>
  refreshMasterServer: () => Promise<unknown>
  resetMasterPairingCode: () => Promise<{ code: string }>
  revokeMasterDevice: (deviceId: string) => Promise<{ ok: boolean }>
  authLoginLocal: (username: string, passwordHash: string) => Promise<{ ok: boolean; user?: unknown; error?: string }>
  authStoreCredential: (username: string, passwordHash: string, user: unknown) => Promise<{ ok: boolean; error?: string }>
  getLocalStoreStatus: () => Promise<{
    ok: boolean
    path: string
    pendingOutbox: number
    error?: string
  }>
  cacheDocuments: (
    collectionName: string,
    documents: Array<{ id: string; data: unknown }>
  ) => Promise<{ ok: boolean }>
  getCachedDocuments: (collectionName: string) => Promise<unknown[]>
  getCachedDocument: (collectionName: string, documentId: string) => Promise<unknown | null>
  deleteCachedDocument: (collectionName: string, documentId: string) => Promise<{ ok: boolean; deleted: boolean }>

  // Atomic batch — all ops in one SQLite transaction, also enqueues to outbox
  executeBatch: (operations: Array<{ collection: string; id: string; data: unknown; op: 'set' | 'delete' }>) => Promise<{ ok: boolean; error?: string }>

  // Database backup & restore — REQ-8
  backupDatabase: () => Promise<{ ok: boolean; error?: string }>
  restoreDatabase: () => Promise<{ ok: boolean; error?: string }>

  // Materialized stock reads — REQ-11
  getIngredientStocks: () => Promise<Array<{ ingredient_id: string; quantity: number }>>

  // Sync outbox
  outboxGetPending: () => Promise<unknown[]>
  outboxEnqueue: (entityType: string, entityId: string, operation: 'set' | 'delete', payload: unknown) => Promise<{ ok: boolean }>
  outboxMarkSynced: (ids: string[]) => Promise<{ ok: boolean }>
  outboxMarkFailed: (ids: string[]) => Promise<{ ok: boolean }>
  outboxResetFailed: () => Promise<{ ok: boolean }>
  outboxCountPending: () => Promise<{ count: number }>
  devResetDatabase: () => Promise<{ ok: boolean; error?: string }>

  // Auto-updater — actions
  updaterCheckNow: () => Promise<void>
  updaterStartDownload: () => Promise<void>
  updaterQuitAndInstall: () => Promise<void>

  // Auto-updater — event subscriptions (return an unsubscribe fn)
  onUpdateAvailable: (
    cb: (info: { version: string; releaseNotes: string | null }) => void
  ) => () => void
  onDownloadProgress: (
    cb: (progress: { percent: number; transferred: number; total: number }) => void
  ) => () => void
  onUpdateDownloaded: (cb: (info: { version: string }) => void) => () => void
  onUpdaterError: (cb: (err: { message: string }) => void) => () => void
  onUpdateUpToDate: (cb: (info: { latestVersion: string }) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
