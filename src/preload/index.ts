import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  printReceipt: (html: string): Promise<boolean> =>
    ipcRenderer.invoke('print:receipt', html),
  deleteAuthUser: (uid: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('auth:delete-user', uid),
  resetAuthUserPassword: (uid: string, newPassword: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('auth:reset-password', uid, newPassword),
  ensureAuthUser: (params: { uid: string; email: string; password: string; displayName: string }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('auth:ensure-user', params),
  getAdminDocument: (collectionName: string, documentId: string): Promise<{ ok: boolean; data?: unknown | null; error?: string }> =>
    ipcRenderer.invoke('admin:get-document', collectionName, documentId),
  setAdminDocument: (collectionName: string, documentId: string, data: unknown): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('admin:set-document', collectionName, documentId, data),

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
  activateMasterKey: (key: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('license:activate-master-key', key),
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
  authLoginLocal: (username: string, passwordHash: string): Promise<{ ok: boolean; user?: unknown; error?: string }> =>
    ipcRenderer.invoke('auth:login-local', username, passwordHash),
  authStoreCredential: (username: string, passwordHash: string, user: unknown): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('auth:store-credential', username, passwordHash, user),
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
  outboxGetPending: (): Promise<unknown[]> =>
    ipcRenderer.invoke('outbox:get-pending'),
  outboxEnqueue: (entityType: string, entityId: string, operation: 'set' | 'delete', payload: unknown): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('outbox:enqueue', entityType, entityId, operation, payload),
  outboxMarkSynced: (ids: string[]): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('outbox:mark-synced', ids),
  outboxMarkFailed: (ids: string[]): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('outbox:mark-failed', ids),
  outboxResetFailed: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('outbox:reset-failed'),
  outboxCountPending: (): Promise<{ count: number }> =>
    ipcRenderer.invoke('outbox:count-pending'),
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
