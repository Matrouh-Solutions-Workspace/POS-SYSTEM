import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  printReceipt: (html: string): Promise<{ ok: boolean; error?: string; code?: string }> =>
    ipcRenderer.invoke('print:receipt', html),
  listPrinters: (): Promise<Array<{ name: string; displayName: string; description?: string; isDefault?: boolean; status?: number }>> =>
    ipcRenderer.invoke('print:list-printers'),
  printKitchenBatch: (jobs: Array<{ printerId: string; printerName: string; deviceName: string; copies?: number; html: string }>): Promise<{ ok: boolean; printed: number; failed: Array<{ printerName: string; error: string }> }> =>
    ipcRenderer.invoke('print:kitchen-batch', jobs),
  getDefaultReceiptPrinter: (): Promise<{ deviceName: string; displayName: string; updatedAt: number } | null> =>
    ipcRenderer.invoke('print:get-default-receipt-printer'),
  setDefaultReceiptPrinter: (printer: { deviceName: string; displayName?: string } | null): Promise<{ ok: boolean; printer: { deviceName: string; displayName: string; updatedAt: number } | null }> =>
    ipcRenderer.invoke('print:set-default-receipt-printer', printer),
  getDefaultReportPrinter: (): Promise<{ deviceName: string; displayName: string; updatedAt: number; options?: { pageSize: 'A4' | 'Letter'; orientation: 'portrait' | 'landscape'; copies: number } } | null> =>
    ipcRenderer.invoke('print:get-default-report-printer'),
  setDefaultReportPrinter: (printer: { deviceName: string; displayName?: string; options?: { pageSize: 'A4' | 'Letter'; orientation: 'portrait' | 'landscape'; copies: number } } | null): Promise<{ ok: boolean; printer: { deviceName: string; displayName: string; updatedAt: number; options?: { pageSize: 'A4' | 'Letter'; orientation: 'portrait' | 'landscape'; copies: number } } | null }> =>
    ipcRenderer.invoke('print:set-default-report-printer', printer),
  testDefaultPrinter: (kind: 'receipt' | 'report'): Promise<{ ok: boolean; error?: string; code?: string }> =>
    ipcRenderer.invoke('print:test-default-printer', kind),
  printReport: (html: string, options?: { pageSize: 'A4' | 'Letter'; orientation: 'portrait' | 'landscape'; copies: number }): Promise<{ ok: boolean; error?: string; code?: string }> =>
    ipcRenderer.invoke('print:report', html, options),
  // App version & control
  getAppVersion: (): Promise<string> =>
    ipcRenderer.invoke('app:get-version'),
  restartApp: (): Promise<void> =>
    ipcRenderer.invoke('app:restart'),
  getLicenseStatus: (): Promise<{
    valid: boolean
    reason?: string
    hwid: string
    licensePath: string
    license?: unknown
  }> => ipcRenderer.invoke('license:get-status'),
  createActivationRequest: (): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('license:create-activation-request'),
  importLicense: (): Promise<{ ok: boolean; status?: unknown; error?: string }> =>
    ipcRenderer.invoke('license:import-license'),
  getNetworkStatus: (): Promise<unknown> =>
    ipcRenderer.invoke('network:get-status'),
  pairSideDevice: (params: { masterUrl: string; deviceName: string; code: string }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('network:pair-side', params),
  clearSideConnection: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('network:clear-side'),
  getMasterNetworkStatus: (): Promise<unknown> =>
    ipcRenderer.invoke('network:master-status'),
  refreshMasterServer: (): Promise<unknown> =>
    ipcRenderer.invoke('network:master-refresh'),
  resetMasterPairingCode: (): Promise<{ code: string }> =>
    ipcRenderer.invoke('network:master-reset-pairing-code'),
  revokeMasterDevice: (deviceId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('network:master-revoke-device', deviceId),
  authHasUsers: (): Promise<{ ok: boolean; hasUsers: boolean; error?: string }> =>
    ipcRenderer.invoke('auth:has-users'),
  authLoginLocal: (username: string, password: string): Promise<{ ok: boolean; user?: unknown; error?: string }> =>
    ipcRenderer.invoke('auth:login-local', username, password),
  authStoreCredential: (username: string, password: string, user: unknown): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('auth:store-credential', username, password, user),
  getLocalStoreStatus: (): Promise<{ ok: boolean; path: string; pendingOutbox: number; error?: string }> =>
    ipcRenderer.invoke('local-store:get-status'),
  cacheDocuments: (
    collectionName: string,
    documents: Array<{ id: string; data: unknown }>
  ): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('local-cache:set-documents', collectionName, documents),
  getCachedDocuments: (collectionName: string): Promise<unknown[]> =>
    ipcRenderer.invoke('local-cache:get-documents', collectionName),
  getCachedDocument: (collectionName: string, documentId: string): Promise<unknown | null> =>
    ipcRenderer.invoke('local-cache:get-document', collectionName, documentId),
  deleteCachedDocument: (collectionName: string, documentId: string): Promise<{ ok: boolean; deleted: boolean }> =>
    ipcRenderer.invoke('local-cache:delete-document', collectionName, documentId),

  // Atomic batch — all ops execute in one SQLite transaction
  executeBatch: (operations: Array<{ collection: string; id: string; data: unknown; op: 'set' | 'delete' }>): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('local-cache:execute-batch', operations),

  // Database backup & restore — REQ-8
  backupDatabase: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('local-store:backup'),
  chooseBackupDirectory: (): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('local-store:choose-backup-directory'),
  backupDatabaseToDirectory: (directory: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('local-store:backup-directory-now', directory),
  restoreDatabase: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('local-store:restore'),
  exportReportPdf: (html: string, suggestedName: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('print:pdf-report', html, suggestedName),

  // Materialized stock reads — REQ-11
  getIngredientStocks: (): Promise<Array<{ ingredient_id: string; quantity: number }>> =>
    ipcRenderer.invoke('local-store:get-stocks'),

  // Sync outbox
  outboxEnqueue: (entityType: string, entityId: string, operation: 'set' | 'delete', payload: unknown): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('outbox:enqueue', entityType, entityId, operation, payload),
  outboxCountPending: (): Promise<{ count: number }> =>
    ipcRenderer.invoke('outbox:count-pending'),
  pushApiSync: (): Promise<{
    ok: boolean
    enabled: boolean
    uploaded: number
    failed: number
    pending: number
    skipped?: 'disabled' | 'not_master' | 'invalid_license' | 'empty'
    error?: string
  }> => ipcRenderer.invoke('api-sync:push'),
  devResetDatabase: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('dev:reset-database'),

  // Auto-updater
  updaterCheckNow: (): Promise<void> =>
    ipcRenderer.invoke('updater:check-now'),
  updaterStartDownload: (): Promise<void> =>
    ipcRenderer.invoke('updater:start-download'),
  updaterQuitAndInstall: (): Promise<void> =>
    ipcRenderer.invoke('updater:quit-and-install'),
  onUpdateAvailable: (
    cb: (info: { version: string; releaseNotes: string | null }) => void
  ): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, info: { version: string; releaseNotes: string | null }): void => cb(info)
    ipcRenderer.on('updater:update-available', handler)
    return () => ipcRenderer.removeListener('updater:update-available', handler)
  },
  onDownloadProgress: (
    cb: (progress: { percent: number; transferred: number; total: number }) => void
  ): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, progress: { percent: number; transferred: number; total: number }): void => cb(progress)
    ipcRenderer.on('updater:download-progress', handler)
    return () => ipcRenderer.removeListener('updater:download-progress', handler)
  },
  onUpdateDownloaded: (cb: (info: { version: string }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, info: { version: string }): void => cb(info)
    ipcRenderer.on('updater:update-downloaded', handler)
    return () => ipcRenderer.removeListener('updater:update-downloaded', handler)
  },
  onUpdaterError: (cb: (err: { message: string }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, err: { message: string }): void => cb(err)
    ipcRenderer.on('updater:error', handler)
    return () => ipcRenderer.removeListener('updater:error', handler)
  },
  onUpdateUpToDate: (cb: (info: { latestVersion: string }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, info: { latestVersion: string }): void => cb(info)
    ipcRenderer.on('updater:up-to-date', handler)
    return () => ipcRenderer.removeListener('updater:up-to-date', handler)
  }
})
