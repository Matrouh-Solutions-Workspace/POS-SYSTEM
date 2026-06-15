import { ipcMain, BrowserWindow, app } from 'electron'
import pkg from 'electron-updater'
const { autoUpdater } = pkg
type UpdateInfo = import('electron-updater').UpdateInfo

function getMainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0]
}

function send(channel: string, payload?: unknown): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

export function initAutoUpdater(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false

  // For private repos: pass the token so GitHub allows access.
  // In production the GH_TOKEN env var must be set at build time
  // so electron-builder embeds it in app-update.yml inside the asar.
  // In dev it comes from the local environment.
  const isDev = Boolean(process.env['ELECTRON_RENDERER_URL'])
  if (isDev) {
    autoUpdater.forceDevUpdateConfig = true
  }
  const token = process.env['GH_TOKEN'] ?? process.env['GITHUB_TOKEN']
  if (token) {
    autoUpdater.addAuthHeader(`token ${token}`)
  } else if (!isDev) {
    console.warn('[updater] No GH_TOKEN found — private repo updates will fail')
  }

  // Enable logging so errors surface to the console
  autoUpdater.logger = {
    info:  (msg: unknown) => console.log('[updater]', msg),
    warn:  (msg: unknown) => console.warn('[updater]', msg),
    error: (msg: unknown) => console.error('[updater]', msg),
    debug: (msg: unknown) => console.log('[updater:debug]', msg)
  }

  // ── Events ──────────────────────────────────────────────────────────────

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    send('updater:update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes ?? null
    })
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    send('updater:up-to-date', { latestVersion: info.version })
  })

  autoUpdater.on('download-progress', (progress) => {
    send('updater:download-progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    send('updater:update-downloaded', { version: info.version })
  })

  autoUpdater.on('error', (err: Error) => {
    // Ignore missing latest.yml — happens when a release was published
    // without the yml file (e.g. interrupted publish). Not a real error.
    if (err.message.includes('latest.yml') || err.message.includes('Cannot find')) {
      console.warn('[updater] skipping incomplete release:', err.message)
      return
    }
    // Pass the raw message — the renderer normalizeUpdaterMessage() will
    // translate network errors to a user-friendly Arabic string.
    const msg = err.message.trim()
    send('updater:error', { message: msg })
  })

  // ── IPC handlers (registered once) ──────────────────────────────────────

  ipcMain.handle('updater:check-now', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      console.log('[updater] check result:', result)
    } catch (e) {
      const msg = e instanceof Error ? e.message.trim() : String(e)
      console.error('[updater] check-now error:', msg)
      send('updater:error', { message: msg })
    }
  })

  ipcMain.handle('updater:start-download', async () => {
    try {
      console.log('[updater] starting download...')
      await autoUpdater.downloadUpdate()
      console.log('[updater] download started')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[updater] download error:', msg)
      send('updater:error', { message: msg })
    }
  })

  ipcMain.handle('updater:quit-and-install', () => {
    autoUpdater.quitAndInstall(false, true)
  })

  // ── Delay check until window is ready so send() works ───────────────────
  // Wait for the first browser window to finish loading before checking
  app.once('browser-window-created', (_, win) => {
    win.webContents.once('did-finish-load', () => {
      // Small delay to ensure React has mounted and listeners are attached
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err: Error) => {
          console.warn('[updater] check failed:', err.message)
        })
      }, 3000)

      // Check every hour while the app stays open
      setInterval(() => {
        autoUpdater.checkForUpdates().catch((err: Error) => {
          console.warn('[updater] periodic check failed:', err.message)
        })
      }, 60 * 60 * 1000)
    })
  })
}
