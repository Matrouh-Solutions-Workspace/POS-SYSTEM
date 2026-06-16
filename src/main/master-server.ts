import { app } from 'electron'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import {
  addPairedDevice,
  DEFAULT_MASTER_PORT,
  readPairedDevices,
  revokePairedDevice,
  touchPairedDevice
} from './network-config'
import {
  cacheDocuments,
  deleteCachedDocument,
  executeBatch,
  readCachedDocument,
  readCachedDocuments,
  readIngredientStocks,
  verifyAuthCredential
} from './local-store'
import { getLicenseStatus } from './license'

interface MasterServerOptions {
  printReceiptHtml: (html: string) => Promise<boolean>
}

let server: Server | null = null
let activePort = DEFAULT_MASTER_PORT
let lastError: string | undefined
let pairingCode = newPairingCode()
let printReceiptHtml: MasterServerOptions['printReceiptHtml'] | null = null

function newPairingCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function rotatePairingCode(): string {
  pairingCode = newPairingCode()
  return pairingCode
}

function localLanAddresses(): string[] {
  const addresses: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address)
    }
  }
  return addresses
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(raw)
  })
  res.end(raw)
}

function ok(res: ServerResponse, data?: unknown): void {
  send(res, 200, { ok: true, data })
}

function fail(res: ServerResponse, status: number, error: string): void {
  send(res, status, { ok: false, error })
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 2_000_000) {
        req.destroy(new Error('Request body too large'))
      }
    })
    req.on('end', () => {
      if (!raw) { resolve({}); return }
      try { resolve(JSON.parse(raw) as unknown) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function tokenFrom(req: IncomingMessage): string {
  const header = req.headers.authorization ?? ''
  const value = Array.isArray(header) ? header[0] : header
  return value?.startsWith('Bearer ') ? value.slice('Bearer '.length).trim() : ''
}

function requireDevice(req: IncomingMessage, res: ServerResponse): boolean {
  const token = tokenFrom(req)
  if (!token || !touchPairedDevice(token)) {
    fail(res, 401, 'Side device is not paired with this master')
    return false
  }
  return true
}

function routeNotFound(res: ServerResponse): void {
  fail(res, 404, 'Unknown master endpoint')
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      const license = getLicenseStatus()
      const settings = readCachedDocument('settings', 'app') as { restaurantNameAr?: string; networkMode?: string } | null
      ok(res, {
        appVersion: app.getVersion(),
        role: 'master',
        license: { valid: license.valid, reason: license.reason, license: license.license },
        storeName: settings?.restaurantNameAr,
        networkMode: settings?.networkMode ?? 'standalone',
        serverTime: Date.now()
      })
      return
    }

    if (req.method === 'POST' && url.pathname === '/pair') {
      const body = await readBody(req) as { code?: string; deviceName?: string }
      const license = getLicenseStatus()
      if (!license.valid) { fail(res, 403, license.reason ?? 'Master license is not valid'); return }
      if (String(body.code ?? '').trim() !== pairingCode) {
        fail(res, 403, 'Pairing code is not valid')
        return
      }
      const device = addPairedDevice(body.deviceName ?? 'Side device')
      rotatePairingCode()
      ok(res, {
        token: device.token,
        deviceId: device.id,
        pairedAt: device.pairedAt,
        masterVersion: app.getVersion()
      })
      return
    }

    if (!requireDevice(req, res)) return

    if (req.method === 'POST' && url.pathname === '/auth/login') {
      const body = await readBody(req) as { username?: string; passwordHash?: string }
      ok(res, verifyAuthCredential(body.username ?? '', body.passwordHash ?? ''))
      return
    }

    if (req.method === 'POST' && url.pathname === '/db/get-all') {
      const body = await readBody(req) as { collectionName?: string }
      ok(res, readCachedDocuments(body.collectionName ?? ''))
      return
    }

    if (req.method === 'POST' && url.pathname === '/db/get') {
      const body = await readBody(req) as { collectionName?: string; documentId?: string }
      ok(res, readCachedDocument(body.collectionName ?? '', body.documentId ?? ''))
      return
    }

    if (req.method === 'POST' && url.pathname === '/db/save') {
      const body = await readBody(req) as {
        collectionName?: string
        documents?: Array<{ id: string; data: unknown }>
      }
      cacheDocuments(body.collectionName ?? '', body.documents ?? [])
      ok(res, { ok: true })
      return
    }

    if (req.method === 'POST' && url.pathname === '/db/delete') {
      const body = await readBody(req) as { collectionName?: string; documentId?: string }
      const deleted = deleteCachedDocument(body.collectionName ?? '', body.documentId ?? '')
      ok(res, { ok: true, deleted })
      return
    }

    if (req.method === 'POST' && url.pathname === '/db/batch') {
      const body = await readBody(req) as {
        operations?: Array<{ collection: string; id: string; data: unknown; op: 'set' | 'delete' }>
      }
      ok(res, executeBatch(body.operations ?? []))
      return
    }

    if (req.method === 'GET' && url.pathname === '/db/stocks') {
      ok(res, readIngredientStocks())
      return
    }

    if (req.method === 'POST' && url.pathname === '/print/receipt') {
      const body = await readBody(req) as { html?: string }
      if (!printReceiptHtml) { fail(res, 503, 'Printing is not available'); return }
      ok(res, { printed: await printReceiptHtml(body.html ?? '') })
      return
    }

    routeNotFound(res)
  } catch (e) {
    fail(res, 500, e instanceof Error ? e.message : String(e))
  }
}

export async function startMasterServer(port: number, options: MasterServerOptions): Promise<void> {
  printReceiptHtml = options.printReceiptHtml
  if (server && activePort === port) return
  await stopMasterServer()
  activePort = port
  lastError = undefined
  server = createServer((req, res) => { void handleRequest(req, res) })
  await new Promise<void>((resolve, reject) => {
    server!.once('error', (e) => {
      lastError = e instanceof Error ? e.message : String(e)
      reject(e)
    })
    server!.listen(port, '0.0.0.0', () => resolve())
  })
}

export async function stopMasterServer(): Promise<void> {
  const current = server
  server = null
  if (!current) return
  await new Promise<void>((resolve) => current.close(() => resolve()))
}

export async function syncMasterServerWithSettings(options: MasterServerOptions): Promise<void> {
  const settings = readCachedDocument('settings', 'app') as {
    networkMode?: string
    masterServerPort?: number
  } | null
  if (settings?.networkMode === 'master') {
    await startMasterServer(settings.masterServerPort ?? DEFAULT_MASTER_PORT, options)
  } else {
    await stopMasterServer()
  }
}

export function getMasterServerStatus(): {
  running: boolean
  port: number
  addresses: string[]
  pairingCode: string
  pairedDevices: ReturnType<typeof readPairedDevices>
  lastError?: string
} {
  return {
    running: Boolean(server?.listening),
    port: activePort,
    addresses: localLanAddresses(),
    pairingCode,
    pairedDevices: readPairedDevices(),
    lastError
  }
}

export function resetMasterPairingCode(): string {
  return rotatePairingCode()
}

export function revokeMasterDevice(deviceId: string): boolean {
  return revokePairedDevice(deviceId)
}
