export interface ElectronAPI {
  // Receipt printing
  printReceipt: (html: string) => Promise<{ ok: boolean; error?: string; code?: string }>
  listPrinters: () => Promise<Array<{
    name: string
    displayName: string
    description?: string
    isDefault?: boolean
    status?: number
  }>>
  printKitchenBatch: (jobs: Array<{
    printerId: string
    printerName: string
    deviceName: string
    copies?: number
    html: string
  }>) => Promise<{
    ok: boolean
    printed: number
    failed: Array<{ printerName: string; error: string }>
  }>
  getDefaultReceiptPrinter: () => Promise<{
    deviceName: string
    displayName: string
    updatedAt: number
  } | null>
  setDefaultReceiptPrinter: (printer: {
    deviceName: string
    displayName?: string
  } | null) => Promise<{
    ok: boolean
    printer: {
      deviceName: string
      displayName: string
      updatedAt: number
    } | null
  }>
  getDefaultReportPrinter: () => Promise<{
    deviceName: string
    displayName: string
    updatedAt: number
    options?: {
      pageSize: 'A4' | 'Letter'
      orientation: 'portrait' | 'landscape'
      copies: number
    }
  } | null>
  setDefaultReportPrinter: (printer: {
    deviceName: string
    displayName?: string
    options?: {
      pageSize: 'A4' | 'Letter'
      orientation: 'portrait' | 'landscape'
      copies: number
    }
  } | null) => Promise<{
    ok: boolean
    printer: {
      deviceName: string
      displayName: string
      updatedAt: number
      options?: {
        pageSize: 'A4' | 'Letter'
        orientation: 'portrait' | 'landscape'
        copies: number
      }
    } | null
  }>
  testDefaultPrinter: (kind: 'receipt' | 'report') => Promise<{ ok: boolean; error?: string; code?: string }>
  printReport: (
    html: string,
    options?: {
      pageSize: 'A4' | 'Letter'
      orientation: 'portrait' | 'landscape'
      copies: number
    }
  ) => Promise<{ ok: boolean; error?: string; code?: string }>
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
  activateWithDevCode: (code: string) => Promise<{
    ok: boolean
    status?: { valid: boolean; reason?: string }
    error?: string
  }>
  getNetworkStatus: () => Promise<unknown>
  pairSideDevice: (params: { masterUrl: string; deviceName: string; code: string }) => Promise<{ ok: boolean; error?: string }>
  clearSideConnection: () => Promise<{ ok: boolean }>
  getMasterNetworkStatus: () => Promise<unknown>
  refreshMasterServer: () => Promise<unknown>
  resetMasterPairingCode: () => Promise<{ code: string }>
  revokeMasterDevice: (deviceId: string) => Promise<{ ok: boolean }>
  authHasUsers: () => Promise<{ ok: boolean; hasUsers: boolean; error?: string }>
  authLoginLocal: (username: string, password: string) => Promise<{ ok: boolean; user?: unknown; error?: string }>
  authStoreCredential: (username: string, password: string, user: unknown) => Promise<{ ok: boolean; error?: string }>
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
  chooseBackupDirectory: () => Promise<{ ok: boolean; path?: string; error?: string }>
  backupDatabaseToDirectory: (directory: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  restoreDatabase: () => Promise<{ ok: boolean; error?: string }>
  exportReportPdf: (html: string, suggestedName: string) => Promise<{ ok: boolean; path?: string; error?: string }>

  // Materialized stock reads — REQ-11
  getIngredientStocks: () => Promise<Array<{ ingredient_id: string; quantity: number }>>

  // Sync outbox
  outboxEnqueue: (entityType: string, entityId: string, operation: 'set' | 'delete', payload: unknown) => Promise<{ ok: boolean }>
  outboxCountPending: () => Promise<{ count: number }>
  pushApiSync: () => Promise<{
    ok: boolean
    enabled: boolean
    uploaded: number
    failed: number
    pending: number
    skipped?: 'disabled' | 'not_master' | 'invalid_license' | 'empty'
    error?: string
  }>
  devResetDatabase: () => Promise<{ ok: boolean; error?: string }>
  devResetManagerLogin: () => Promise<{ ok: boolean; username?: string; password?: string; error?: string }>

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
