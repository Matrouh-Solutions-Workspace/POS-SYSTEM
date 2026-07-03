import { ipcMain, BrowserWindow, app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import pkg from 'electron-updater'
import { publishDownloadedUpdateForMaster } from './master-update-artifacts'
import { readSideConnection } from './network-config'

const { autoUpdater } = pkg
type UpdateInfo = import('electron-updater').UpdateInfo
type UpdateDownloadedEvent = import('electron-updater').UpdateDownloadedEvent

let sideFeedKey: string | null = null

const PRIVATE_TOKEN_KEYS = ['GH_TOKEN', 'GITHUB_TOKEN', 'SHIFT_POS_UPDATE_TOKEN'] as const

function getMainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0]
}

function send(channel: string, payload?: unknown): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

function normalizeToken(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readTokenFromEnvFile(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined
  try {
    const raw = readFileSync(filePath, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const equalsIndex = trimmed.indexOf('=')
      if (equalsIndex <= 0) continue
      const key = trimmed.slice(0, equalsIndex).trim()
      if (!PRIVATE_TOKEN_KEYS.includes(key as (typeof PRIVATE_TOKEN_KEYS)[number])) continue
      const value = trimmed.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, '')
      const token = normalizeToken(value)
      if (token) return token
    }
  } catch (error) {
    console.warn('[updater] failed to read env token file:', error instanceof Error ? error.message : String(error))
  }
  return undefined
}

function readPrivateUpdateToken(): string | undefined {
  for (const key of PRIVATE_TOKEN_KEYS) {
    const token = normalizeToken(process.env[key])
    if (token) return token
  }

  const candidates = [
    join(process.resourcesPath, 'updater-auth.json'),
    join(app.getPath('userData'), 'updater-auth.json'),
    join(app.getPath('userData'), 'update-token.txt'),
    join(app.getPath('userData'), '.env'),
    join(dirname(process.execPath), '.env'),
    join(process.cwd(), '.env')
  ]

  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue
    try {
      const raw = readFileSync(filePath, 'utf8').trim()
      if (!raw) continue
      if (filePath.endsWith('.json')) {
        const parsed = JSON.parse(raw) as { token?: unknown; ghToken?: unknown; githubToken?: unknown }
        const token = parsed.token ?? parsed.ghToken ?? parsed.githubToken
        const normalized = normalizeToken(token)
        if (normalized) return normalized
        continue
      }
      if (filePath.endsWith('.env')) {
        const token = readTokenFromEnvFile(filePath)
        if (token) return token
        continue
      }
      return raw
    } catch (error) {
      console.warn('[updater] failed to read private update token:', error instanceof Error ? error.message : String(error))
    }
  }

  return undefined
}

function configurePrivateGitHubAuth(isDev: boolean): void {
  const token = readPrivateUpdateToken()
  if (token) {
    process.env['GH_TOKEN'] = token
    autoUpdater.addAuthHeader(`token ${token}`)
  } else if (!isDev) {
    console.warn('[updater] No GitHub token found; private repo updates will fail on master devices')
  }
}

function configureUpdateProviderAuth(isDev: boolean): void {
  if (!configureSideUpdateFeed()) configurePrivateGitHubAuth(isDev)
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

  configureUpdateProviderAuth(isDev)

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
      configureUpdateProviderAuth(isDev)
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
      configureUpdateProviderAuth(isDev)
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
        configureUpdateProviderAuth(isDev)
        autoUpdater.checkForUpdates().catch((err: Error) => {
          console.warn('[updater] check failed:', err.message)
        })
      }, 3000)

      setInterval(() => {
        configureUpdateProviderAuth(isDev)
        autoUpdater.checkForUpdates().catch((err: Error) => {
          console.warn('[updater] periodic check failed:', err.message)
        })
      }, 60 * 60 * 1000)
    })
  })
}
