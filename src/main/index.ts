import { app, BrowserWindow, ipcMain, globalShortcut, Menu } from 'electron'
import { dirname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { callMaster, callMasterWithConfig } from './master-client'
import {
  clearSideConnection,
  isSideMode,
  normalizeMasterUrl,
  readSideConnection,
  writeSideConnection
} from './network-config'
import {
  getMasterServerStatus,
  resetMasterPairingCode,
  revokeMasterDevice,
  syncMasterServerWithSettings
} from './master-server'

/** True only for `npm run dev` (electron-vite), not for installer or preview builds */
const isDev = Boolean(process.env['ELECTRON_RENDERER_URL'])

let mainWindow: BrowserWindow | null = null
let backupScheduler: ReturnType<typeof setInterval> | null = null

function enableWindowsStartup(): void {
  if (process.platform !== 'win32' || isDev || !app.isPackaged) return

  try {
    const path = process.execPath
    const settings = app.getLoginItemSettings({ path })
    if (!settings.openAtLogin) {
      app.setLoginItemSettings({
        openAtLogin: true,
        path
      })
    }
  } catch (error) {
    console.warn('[startup]', error)
  }
}

function toggleDevTools(win: BrowserWindow | null = mainWindow): void {
  if (!isDev || !win) return
  if (win.webContents.isDevToolsOpened()) {
    win.webContents.closeDevTools()
  } else {
    win.webContents.openDevTools({ mode: 'detach', activate: true })
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: 'SHIFT POS',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: isDev
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (isDev) {
      mainWindow?.webContents.openDevTools({ mode: 'detach', activate: false })
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error('[did-fail-load]', errorCode, errorDescription, validatedURL)
    }
  )

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function printReceiptHtml(html: string): Promise<boolean> {
  const printWindow = new BrowserWindow({
    width: 380,
    height: 600,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })

  try {
    await printWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    )

    await new Promise<void>((resolve) => setTimeout(resolve, 500))

    return await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        if (!printWindow.isDestroyed()) printWindow.close()
        resolve(false)
      }, 30000)

      printWindow.webContents.print(
        {
          silent: false,
          printBackground: true,
          pageSize: { width: 80000, height: 297000 }
        },
        (success) => {
          clearTimeout(timeout)
          if (!printWindow.isDestroyed()) printWindow.close()
          resolve(success)
        }
      )
    })
  } catch (e) {
    console.error('[print]', e)
    if (!printWindow.isDestroyed()) printWindow.close()
    return false
  }
}

interface TargetedPrintJob {
  printerId: string
  printerName: string
  deviceName: string
  copies?: number
  html: string
}

interface DefaultReceiptPrinter {
  deviceName: string
  displayName: string
  updatedAt: number
}

type DefaultPrinterKind = 'receipt' | 'report'

interface ReportPrintOptions {
  pageSize: 'A4' | 'Letter'
  orientation: 'portrait' | 'landscape'
  copies: number
}

interface PrintResult {
  ok: boolean
  error?: string
  code?: 'NO_DEFAULT_PRINTER' | 'PRINT_FAILED'
}

function defaultPrinterInstructions(kind: DefaultPrinterKind): string {
  const label = kind === 'receipt' ? 'الفواتير' : 'التقارير'
  return `لم يتم تحديد طابعة ${label} الافتراضية لهذا الجهاز. افتح حساب المدير ثم الإعدادات ثم الطابعات، اختر طابعة ${label} لهذا الجهاز، اضغط حفظ، ثم اضغط اختبار الطباعة.`
}

function defaultPrinterConfigPath(kind: DefaultPrinterKind): string {
  return join(app.getPath('userData'), kind === 'receipt' ? 'receipt-printer.json' : 'report-printer.json')
}

function readDefaultPrinter(kind: DefaultPrinterKind): (DefaultReceiptPrinter & { options?: ReportPrintOptions }) | null {
  try {
    const path = defaultPrinterConfigPath(kind)
    if (!existsSync(path)) return null
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<DefaultReceiptPrinter & { options: ReportPrintOptions }>
    if (!parsed.deviceName) return null
    return {
      deviceName: parsed.deviceName,
      displayName: parsed.displayName || parsed.deviceName,
      updatedAt: parsed.updatedAt || 0,
      options: parsed.options
    }
  } catch {
    return null
  }
}

function writeDefaultPrinter(
  kind: DefaultPrinterKind,
  printer: ({ deviceName: string; displayName?: string; options?: ReportPrintOptions } | null)
): (DefaultReceiptPrinter & { options?: ReportPrintOptions }) | null {
  const path = defaultPrinterConfigPath(kind)
  mkdirSync(dirname(path), { recursive: true })
  if (!printer?.deviceName) {
    writeFileSync(path, JSON.stringify(null, null, 2), 'utf8')
    return null
  }
  const value: DefaultReceiptPrinter = {
    deviceName: printer.deviceName,
    displayName: printer.displayName || printer.deviceName,
    updatedAt: Date.now()
  }
  const withOptions = kind === 'report'
    ? { ...value, options: normalizeReportPrintOptions(printer.options) }
    : value
  writeFileSync(path, JSON.stringify(withOptions, null, 2), 'utf8')
  return withOptions
}

function readDefaultReceiptPrinter(): DefaultReceiptPrinter | null {
  return readDefaultPrinter('receipt')
}

function writeDefaultReceiptPrinter(printer: { deviceName: string; displayName?: string } | null): DefaultReceiptPrinter | null {
  const value = writeDefaultPrinter('receipt', printer)
  return value
}

function normalizeReportPrintOptions(options?: Partial<ReportPrintOptions>): ReportPrintOptions {
  return {
    pageSize: options?.pageSize === 'Letter' ? 'Letter' : 'A4',
    orientation: options?.orientation === 'landscape' ? 'landscape' : 'portrait',
    copies: Math.max(1, Math.min(5, Number(options?.copies) || 1))
  }
}

async function printHtmlToDevice(
  html: string,
  deviceName: string,
  copies = 1,
  options?: { pageSize?: 'A4' | 'Letter' | { width: number; height: number }; landscape?: boolean }
): Promise<boolean> {
  const printWindow = new BrowserWindow({
    width: 380,
    height: 700,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })

  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await new Promise<void>((resolve) => setTimeout(resolve, 300))

    for (let i = 0; i < Math.max(1, Math.min(5, copies)); i += 1) {
      const printed = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          if (!printWindow.isDestroyed()) printWindow.close()
          resolve(false)
        }, 30000)

        printWindow.webContents.print(
          {
            silent: true,
            printBackground: true,
            deviceName,
            pageSize: options?.pageSize ?? { width: 80000, height: 297000 },
            landscape: options?.landscape
          },
          (success) => {
            clearTimeout(timeout)
            resolve(success)
          }
        )
      })
      if (!printed) return false
    }
    return true
  } catch (e) {
    console.error('[targeted-print]', e)
    return false
  } finally {
    if (!printWindow.isDestroyed()) printWindow.close()
  }
}

async function printReceiptUsingDefault(html: string): Promise<PrintResult> {
  const defaultPrinter = readDefaultReceiptPrinter()
  if (defaultPrinter?.deviceName) {
    const ok = await printHtmlToDevice(html, defaultPrinter.deviceName, 1)
    if (ok) return { ok: true }
    console.warn('[receipt-print]', `Default receipt printer failed: ${defaultPrinter.displayName}`)
    return { ok: false, code: 'PRINT_FAILED', error: `فشلت الطباعة على ${defaultPrinter.displayName}` }
  }
  return { ok: false, code: 'NO_DEFAULT_PRINTER', error: defaultPrinterInstructions('receipt') }
}

async function printReportUsingDefault(html: string, options?: Partial<ReportPrintOptions>): Promise<PrintResult> {
  const defaultPrinter = readDefaultPrinter('report')
  if (!defaultPrinter?.deviceName) {
    return { ok: false, code: 'NO_DEFAULT_PRINTER', error: defaultPrinterInstructions('report') }
  }
  const printOptions = normalizeReportPrintOptions(options ?? defaultPrinter.options)
  const ok = await printHtmlToDevice(html, defaultPrinter.deviceName, printOptions.copies, {
    pageSize: printOptions.pageSize,
    landscape: printOptions.orientation === 'landscape'
  })
  return ok
    ? { ok: true }
    : { ok: false, code: 'PRINT_FAILED', error: `فشلت طباعة التقرير على ${defaultPrinter.displayName}` }
}

async function printDefaultPrinterTest(kind: DefaultPrinterKind): Promise<PrintResult> {
  const title = kind === 'receipt' ? 'Receipt printer test' : 'Report printer test'
  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/><style>body{font-family:Arial,Tahoma,sans-serif;margin:20px;color:#111}h1{font-size:20px}p{font-size:14px}</style></head><body><h1>${title}</h1><p>اختبار طباعة ناجح من SHIFT POS</p><p>${new Date().toLocaleString('ar-EG')}</p></body></html>`
  return kind === 'receipt' ? printReceiptUsingDefault(html) : printReportUsingDefault(html)
}

async function printKitchenBatch(jobs: TargetedPrintJob[]): Promise<{
  ok: boolean
  printed: number
  failed: Array<{ printerName: string; error: string }>
}> {
  const failed: Array<{ printerName: string; error: string }> = []
  let printed = 0

  for (const job of jobs) {
    if (!job.deviceName) {
      failed.push({ printerName: job.printerName, error: 'لم يتم تحديد طابعة لهذا الطلب. افتح حساب المدير ثم الإعدادات ثم الطابعات، وحدد الطابعة الافتراضية أو اربط طابعة التجهيز بطابعة فعلية.' })
      continue
    }
    const ok = await printHtmlToDevice(job.html, job.deviceName, job.copies ?? 1)
    if (ok) printed += 1
    else failed.push({ printerName: job.printerName, error: 'Print job failed' })
  }

  return { ok: failed.length === 0, printed, failed }
}

async function exportHtmlToPdf(html: string, suggestedName: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  const { dialog } = await import('electron')
  const result = await dialog.showSaveDialog({
    title: 'Save PDF report',
    defaultPath: suggestedName.endsWith('.pdf') ? suggestedName : `${suggestedName}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (result.canceled || !result.filePath) return { ok: false, error: 'Cancelled' }

  const pdfWindow = new BrowserWindow({
    width: 1000,
    height: 1200,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })

  try {
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await new Promise<void>((resolve) => setTimeout(resolve, 250))
    const pdf = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'default' }
    })
    writeFileSync(result.filePath, pdf)
    return { ok: true, path: result.filePath }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    if (!pdfWindow.isDestroyed()) pdfWindow.close()
  }
}

function startBackupScheduler(): void {
  if (backupScheduler || isSideMode()) return
  const tick = (): void => {
    const result = runConfiguredBackup('scheduled')
    if (!result.ok && !result.skipped) console.warn('[backup]', result.error)
  }
  tick()
  backupScheduler = setInterval(tick, 60 * 60 * 1000)
}

import { pushOutboxToApi } from './api-sync'
import { initAutoUpdater } from './auto-updater'
import {
  activateWithDevCode,
  createActivationRequestFile,
  getLicenseStatus,
  importLicenseFile
} from './license'
import {
  cacheDocuments,
  countPendingOutbox,
  deleteCachedDocument,
  enqueueOutbox,
  executeBatch,
  backupDatabase,
  backupDatabaseToDirectory,
  restoreDatabase,
  readIngredientStocks,
  getLocalStoreStatus,
  initLocalStore,
  readCachedDocument,
  readCachedDocuments,
  resetManagerLoginForDev,
  resetDatabase,
  runConfiguredBackup,
  deleteAuthCredentialForUser,
  hasAuthCredentials,
  storeAuthCredential,
  verifyAuthCredential
} from './local-store'

app.whenReady().then(() => {
  if (!isDev) {
    Menu.setApplicationMenu(null)
  }
  enableWindowsStartup()

  // Init updater in both dev and prod
  // (forceDevUpdateConfig handles the dev case via dev-app-update.yml)
  initAutoUpdater()
  if (!isSideMode() && getLicenseStatus().valid) {
    initLocalStore()
    startBackupScheduler()
    void syncMasterServerWithSettings({ printReceiptHtml: async (html) => (await printReceiptUsingDefault(html)).ok, printKitchenBatch }).catch((e) => {
      console.error('[master-server]', e)
    })
  }

  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('license:get-status', async () => getLicenseStatus())
  ipcMain.handle('license:create-activation-request', () => createActivationRequestFile())
  ipcMain.handle('license:import-license', () => importLicenseFile())
  ipcMain.handle('license:activate-with-dev-code', (_, code: string) => activateWithDevCode(code))
  ipcMain.handle('network:get-status', async () => {
    const side = readSideConnection()
    if (side) {
      try {
        const health = await callMasterWithConfig(side, '/health', undefined, { method: 'GET', auth: false })
        await callMasterWithConfig(side, '/pairing-status', undefined, { method: 'GET' })
        return { mode: 'side' as const, side, connected: true, health }
      } catch (e) {
        return { mode: 'side' as const, side, connected: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
    return { mode: 'local' as const, master: getMasterServerStatus() }
  })
  ipcMain.handle('network:pair-side', async (_, params: { masterUrl: string; deviceName: string; code: string }) => {
    try {
      const localLicense = getLicenseStatus()
      if (!localLicense.valid) {
        return { ok: false as const, error: localLicense.reason ?? 'Activate this side device license before pairing' }
      }
      const masterUrl = normalizeMasterUrl(params.masterUrl)
      const result = await callMasterWithConfig<{
        token: string
        deviceId: string
        pairedAt: number
      }>({ mode: 'side', masterUrl, deviceName: params.deviceName, pairingToken: '', pairedAt: Date.now() }, '/pair', {
        code: params.code,
        deviceName: params.deviceName
      }, { auth: false })
      writeSideConnection({
        mode: 'side',
        masterUrl,
        deviceName: params.deviceName.trim() || 'Side device',
        pairingToken: result.token,
        pairedAt: result.pairedAt
      })
      return { ok: true as const }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('network:clear-side', () => {
    clearSideConnection()
    return { ok: true as const }
  })
  ipcMain.handle('network:master-status', () => getMasterServerStatus())
  ipcMain.handle('network:master-refresh', async () => {
    await syncMasterServerWithSettings({ printReceiptHtml: async (html) => (await printReceiptUsingDefault(html)).ok, printKitchenBatch })
    return getMasterServerStatus()
  })
  ipcMain.handle('network:master-reset-pairing-code', () => ({ code: resetMasterPairingCode() }))
  ipcMain.handle('network:master-revoke-device', (_, deviceId: string) => ({
    ok: revokeMasterDevice(deviceId)
  }))
  ipcMain.handle('auth:has-users', async () => {
    if (isSideMode()) return callMaster('/auth/has-users')
    return { ok: true as const, hasUsers: hasAuthCredentials() }
  })
  ipcMain.handle('auth:login-local', async (_, username: string, password: string) => {
    if (isSideMode()) return callMaster('/auth/login', { username, password })
    return verifyAuthCredential(username, password)
  })
  ipcMain.handle('auth:store-credential', (_, username: string, password: string, user: unknown) => {
    if (isSideMode()) return callMaster('/auth/store-credential', { username, password, user })
    return storeAuthCredential(username, password, user)
  })
  ipcMain.handle('local-store:get-status', async () => {
    if (isSideMode()) {
      try {
        await callMaster('/health', undefined, { method: 'GET' })
        return { ok: true, path: 'master database', pendingOutbox: 0 }
      } catch (e) {
        return {
          ok: false,
          path: 'master database',
          pendingOutbox: 0,
          error: e instanceof Error ? e.message : String(e)
        }
      }
    }
    return getLocalStoreStatus()
  })
  ipcMain.handle('local-cache:set-documents', async (_, collectionName: string, documents: Array<{ id: string; data: unknown }>) => {
    if (isSideMode()) return callMaster('/db/save', { collectionName, documents })
    cacheDocuments(collectionName, documents)
    if (collectionName === 'settings') {
      void syncMasterServerWithSettings({ printReceiptHtml: async (html) => (await printReceiptUsingDefault(html)).ok, printKitchenBatch }).catch((e) => console.error('[master-server]', e))
    }
    return { ok: true as const }
  })
  ipcMain.handle('local-cache:get-documents', async (_, collectionName: string) => {
    if (isSideMode()) return callMaster('/db/get-all', { collectionName })
    return readCachedDocuments(collectionName)
  })
  ipcMain.handle('local-cache:get-document', async (_, collectionName: string, documentId: string) => {
    if (isSideMode()) return callMaster('/db/get', { collectionName, documentId })
    return readCachedDocument(collectionName, documentId)
  })

  // SQLite primary database: delete a single document
  ipcMain.handle('local-cache:delete-document', async (_, collectionName: string, documentId: string) => {
    if (isSideMode()) return callMaster('/db/delete', { collectionName, documentId })
    const deleted = deleteCachedDocument(collectionName, documentId)
    if (collectionName === 'users') deleteAuthCredentialForUser(documentId)
    return { ok: true as const, deleted }
  })

  // SQLite atomic batch write — all ops in one transaction
  ipcMain.handle('local-cache:execute-batch', async (_, operations: Array<{ collection: string; id: string; data: unknown; op: 'set' | 'delete' }>) => {
    if (isSideMode()) return callMaster('/db/batch', { operations })
    const result = executeBatch(operations)
    if (operations.some((op) => op.collection === 'settings')) {
      void syncMasterServerWithSettings({ printReceiptHtml: async (html) => (await printReceiptUsingDefault(html)).ok, printKitchenBatch }).catch((e) => console.error('[master-server]', e))
    }
    return result
  })

  // Materialized stock reads — REQ-11
  ipcMain.handle('local-store:get-stocks', async () => {
    if (isSideMode()) return callMaster('/db/stocks', undefined, { method: 'GET' })
    return readIngredientStocks()
  })

  // Database backup — copy SQLite file to user-chosen location
  ipcMain.handle('local-store:backup', async () => {
    const { dialog } = await import('electron')
    if (isSideMode()) return { ok: false, error: 'Backup is available on the master device only' }
    const today = new Date().toISOString().slice(0, 10)
    const result = await dialog.showSaveDialog({
      title: 'حفظ نسخة احتياطية',
      defaultPath: `shift-pos-backup-${today}.sqlite`,
      filters: [{ name: 'SQLite Database', extensions: ['sqlite'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, error: 'تم الإلغاء' }
    return backupDatabase(result.filePath)
  })

  ipcMain.handle('local-store:choose-backup-directory', async () => {
    if (isSideMode()) return { ok: false, error: 'Backup is available on the master device only' }
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog({
      title: 'Choose backup directory',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, error: 'Cancelled' }
    return { ok: true, path: result.filePaths[0] }
  })

  ipcMain.handle('local-store:backup-directory-now', async (_, directory: string) => {
    if (isSideMode()) return { ok: false, error: 'Backup is available on the master device only' }
    return backupDatabaseToDirectory(directory, 'manual')
  })

  // Database restore — pick a backup file and replace the current DB
  ipcMain.handle('local-store:restore', async () => {
    if (isSideMode()) return { ok: false, error: 'Restore is available on the master device only' }
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog({
      title: 'اختيار ملف النسخة الاحتياطية',
      filters: [{ name: 'SQLite Database', extensions: ['sqlite'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, error: 'تم الإلغاء' }
    return restoreDatabase(result.filePaths[0]!)
  })

  // Sync outbox: enqueue a document for master-device API upload
  ipcMain.handle('outbox:enqueue', (_, entityType: string, entityId: string, operation: 'set' | 'delete', payload: unknown) => {
    if (isSideMode()) return { ok: true as const }
    enqueueOutbox(entityType, entityId, operation, payload)
    return { ok: true as const }
  })

  // Sync outbox: count pending
  ipcMain.handle('outbox:count-pending', () => {
    if (isSideMode()) return { count: 0 }
    return { count: countPendingOutbox() }
  })

  ipcMain.handle('api-sync:push', () => pushOutboxToApi())

  // DEV ONLY — wipe all SQLite data so the app boots as fresh
  ipcMain.handle('dev:reset-database', () => {
    if (isSideMode()) return { ok: false, error: 'Reset is available on the master device only' }
    return resetDatabase()
  })

  ipcMain.handle('dev:reset-manager-login', () => {
    if (isSideMode()) return { ok: false, error: 'Manager login reset is available on the master device only' }
    return resetManagerLoginForDev()
  })

  ipcMain.handle('app:restart', () => {
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle('print:receipt', async (_, html: string) => {
    if (isSideMode()) {
      try {
        const settings = await callMaster<{ receiptPrintRoute?: string }>(
          '/db/get',
          { collectionName: 'settings', documentId: 'app' }
        )
        if (settings?.receiptPrintRoute === 'master') {
          const result = await callMaster<{ printed: boolean; error?: string }>('/print/receipt', { html })
          return result.printed ? { ok: true as const } : { ok: false as const, error: result.error ?? defaultPrinterInstructions('receipt'), code: 'PRINT_FAILED' as const }
        }
      } catch (e) {
        console.warn('[print-route]', e)
      }
    }
    return printReceiptUsingDefault(html)
  })

  ipcMain.handle('print:list-printers', async () => {
    const printers = await (mainWindow?.webContents.getPrintersAsync() ?? Promise.resolve([]))
    return printers.map((printer) => {
      const details = printer as typeof printer & { isDefault?: boolean; status?: number }
      return {
        name: printer.name,
        displayName: printer.displayName || printer.name,
        description: printer.description,
        isDefault: details.isDefault,
        status: details.status
      }
    })
  })

  ipcMain.handle('print:get-default-receipt-printer', () => {
    return readDefaultReceiptPrinter()
  })

  ipcMain.handle('print:set-default-receipt-printer', (_, printer: { deviceName: string; displayName?: string } | null) => {
    return { ok: true as const, printer: writeDefaultReceiptPrinter(printer) }
  })

  ipcMain.handle('print:get-default-report-printer', () => {
    return readDefaultPrinter('report')
  })

  ipcMain.handle('print:set-default-report-printer', (_, printer: { deviceName: string; displayName?: string; options?: ReportPrintOptions } | null) => {
    return { ok: true as const, printer: writeDefaultPrinter('report', printer) }
  })

  ipcMain.handle('print:test-default-printer', async (_, kind: DefaultPrinterKind) => {
    return printDefaultPrinterTest(kind)
  })

  ipcMain.handle('print:report', async (_, html: string, options?: Partial<ReportPrintOptions>) => {
    return printReportUsingDefault(html, options)
  })

  ipcMain.handle('print:kitchen-batch', async (_, jobs: TargetedPrintJob[]) => {
    if (isSideMode()) {
      try {
        return await callMaster('/print/kitchen-batch', { jobs })
      } catch (e) {
        return {
          ok: false as const,
          printed: 0,
          failed: jobs.map((job) => ({
            printerName: job.printerName,
            error: e instanceof Error ? e.message : String(e)
          }))
        }
      }
    }
    return printKitchenBatch(jobs)
  })

  ipcMain.handle('print:pdf-report', async (_, html: string, suggestedName: string) => {
    return exportHtmlToPdf(html, suggestedName)
  })

  createWindow()

  if (isDev) {
    // Helper — injects a small toast into the renderer window
    function devToast(bg: string, text: string): string {
      return `(function(){
        window.__devToast && clearTimeout(window.__devToast);
        const el = document.createElement('div');
        el.style.cssText =
          'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
          'background:${bg};color:#fff;padding:10px 22px;border-radius:8px;' +
          'font-size:14px;z-index:99999;font-family:sans-serif;' +
          'box-shadow:0 4px 14px rgba(0,0,0,.45);pointer-events:none;white-space:nowrap;';
        el.textContent = ${JSON.stringify(text)};
        document.body.appendChild(el);
        window.__devToast = setTimeout(() => el.remove(), 3500);
      })()`
    }

    // Regular devtools shortcuts
    for (const accel of ['CommandOrControl+Shift+I', 'CommandOrControl+Shift+D', 'F12']) {
      globalShortcut.register(accel, () => {
        toggleDevTools(BrowserWindow.getFocusedWindow() ?? mainWindow)
      })
    }

    // -----------------------------------------------------------------------
    // Ctrl+Shift+1 arms the dev reset menu for 2 s, then:
    //   Ctrl+Shift+R wipes SQLite database (fresh first-run state)
    // -----------------------------------------------------------------------
    let devArmed = false
    let devTimer: ReturnType<typeof setTimeout> | null = null

    function armDev(): void {
      devArmed = true
      if (devTimer) clearTimeout(devTimer)
      devTimer = setTimeout(() => { devArmed = false; devTimer = null }, 2000)
      console.log('[dev] armed - Ctrl+Shift+R = reset DB')
    }

    function disarmDev(): void {
      devArmed = false
      if (devTimer) { clearTimeout(devTimer); devTimer = null }
    }

    globalShortcut.register('CommandOrControl+Shift+1', armDev)

    // Wipe SQLite database
    globalShortcut.register('CommandOrControl+Shift+R', () => {
      if (!devArmed) return
      disarmDev()
      const result = resetDatabase()
      console.log('[dev-reset]', result.ok ? 'Database wiped' : result.error)
      const win = BrowserWindow.getFocusedWindow() ?? mainWindow
      if (win) {
        // Also clear renderer localStorage (auth cache, session, etc.)
        if (result.ok) {
          win.webContents.executeJavaScript('localStorage.clear()').catch(() => {})
        }
        win.webContents.executeJavaScript(devToast(
          result.ok ? '#2980b9' : '#c0392b',
          result.ok
            ? '🗑️ DB wiped — restart app to register fresh'
            : `❌ Reset failed: ${result.error}`
        )).catch(() => {})
      }
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  if (!isSideMode() && getLicenseStatus().valid) {
    const result = runConfiguredBackup('close')
    if (!result.ok && !result.skipped) console.warn('[backup:close]', result.error)
  }
  if (backupScheduler) {
    clearInterval(backupScheduler)
    backupScheduler = null
  }
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
