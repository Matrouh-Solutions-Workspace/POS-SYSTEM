import { ipcMain, BrowserWindow, app } from 'electron'
import pkg from 'electron-updater'
import { publishDownloadedUpdateForMaster } from './master-update-artifacts'
import { readSideConnection } from './network-config'

const { autoUpdater } = pkg
type UpdateInfo = import('electron-updater').UpdateInfo
type UpdateDownloadedEvent = import('electron-updater').UpdateDownloadedEvent

let sideFeedKey: string | null = null

function getMainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0]
}

function send(channel: string, payload?: unknown): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

function configureSideUpdateFeed(): boolean {
  const side = readSideConnection()
  if (!side) return false

  const feedUrl = `${side.masterUrl.replace(/\/+$/, '')}/updates`
  const nextKey = `${feedUrl}|${side.pairingToken}`
  if (sideFeedKey !== nextKey) {
    autoUpdater.setFeedURL(feedUrl)
    autoUpdater.addAuthHeader(`Bearer ${side.pairingToken}`)
    sideFeedKey = nextKey
    console.log('[updater] side device update feed:', feedUrl)
  }

  return true
}

export function initAutoUpdater(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false

  const isDev = Boolean(process.env['ELECTRON_RENDERER_URL'])
  if (isDev) {
    autoUpdater.forceDevUpdateConfig = true
  }

  if (!configureSideUpdateFeed()) {
    const token = process.env['GH_TOKEN'] ?? process.env['GITHUB_TOKEN']
    if (token) {
      autoUpdater.addAuthHeader(`token ${token}`)
    } else if (!isDev) {
      console.warn('[updater] No GH_TOKEN found; private repo updates will fail')
    }
  }

  autoUpdater.logger = {
    info:  (msg: unknown) => console.log('[updater]', msg),
    warn:  (msg: unknown) => console.warn('[updater]', msg),
    error: (msg: unknown) => console.error('[updater]', msg),
    debug: (msg: unknown) => console.log('[updater:debug]', msg)
  }

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

  autoUpdater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
    if (!readSideConnection()) {
      try {
        publishDownloadedUpdateForMaster(info)
        console.log('[updater] published downloaded update for LAN side devices')
      } catch (e) {
        console.warn('[updater] failed to publish LAN update artifact:', e instanceof Error ? e.message : String(e))
      }
    }

    send('updater:update-downloaded', { version: info.version })
  })

  autoUpdater.on('error', (err: Error) => {
    if (!readSideConnection() && (err.message.includes('latest.yml') || err.message.includes('Cannot find'))) {
      console.warn('[updater] skipping incomplete release:', err.message)
      return
    }

    send('updater:error', { message: err.message.trim() })
  })

  ipcMain.handle('updater:check-now', async () => {
    try {
      configureSideUpdateFeed()
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
      configureSideUpdateFeed()
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

  app.once('browser-window-created', (_, win) => {
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        configureSideUpdateFeed()
        autoUpdater.checkForUpdates().catch((err: Error) => {
          console.warn('[updater] check failed:', err.message)
        })
      }, 3000)

      setInterval(() => {
        configureSideUpdateFeed()
        autoUpdater.checkForUpdates().catch((err: Error) => {
          console.warn('[updater] periodic check failed:', err.message)
        })
      }, 60 * 60 * 1000)
    })
  })
}
