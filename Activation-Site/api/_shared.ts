import { randomUUID, sign, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface ActivationRequest {
  schema: 'abdokofta.activation-request.v1'
  appId: string
  appVersion: string
  hwid: string
  machine?: {
    platform?: string
    hostname?: string
  }
  nonce?: string
  createdAt?: number
}

export interface LicensePayload {
  schema: 'abdokofta.license.v1'
  licenseId: string
  customerName?: string
  storeName?: string
  appId: string
  hwid: string
  features?: string[]
  issuedAt: number
  expiresAt?: number
}

export interface VercelRequest {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

export interface VercelResponse {
  status(code: number): VercelResponse
  json(value: unknown): void
  setHeader(name: string, value: string): void
  send(value: string): void
}

interface LocalStore {
  license_activations: unknown[]
  activation_site_events: unknown[]
}

type LocalTable = keyof LocalStore

export function getEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing environment variable: ${name}`)
  return value
}

export function normalizePrivateKey(raw: string): string {
  return raw.replace(/\\n/g, '\n')
}

export function requirePost(req: VercelRequest): void {
  if (req.method !== 'POST') {
    throw Object.assign(new Error('Method not allowed'), { statusCode: 405 })
  }
}

export function assertPassword(password: string | undefined): void {
  const expected = process.env.ADMIN_PASSWORD ?? 'SHIFTPOS@)@^'
  const actualBuffer = Buffer.from(password ?? '')
  const expectedBuffer = Buffer.from(expected)
  const ok = actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  if (!ok) throw Object.assign(new Error('Invalid password'), { statusCode: 401 })
}

export function parseActivationRequest(raw: string): ActivationRequest {
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as ActivationRequest
  if (parsed.schema !== 'abdokofta.activation-request.v1') {
    throw Object.assign(new Error('Invalid activation request schema'), { statusCode: 400 })
  }
  if (!parsed.appId || !parsed.hwid) {
    throw Object.assign(new Error('Activation request is missing appId or hwid'), { statusCode: 400 })
  }
  return parsed
}

export function issueLicense(params: {
  request: ActivationRequest
  customerName?: string
  storeName?: string
  days?: number
  features?: string[]
}): { payload: LicensePayload; signature: string; licenseText: string } {
  const privateKey = normalizePrivateKey(getEnv('LICENSE_PRIVATE_KEY'))
  const issuedAt = Date.now()
  const expiresAt = params.days && params.days > 0
    ? issuedAt + params.days * 24 * 60 * 60 * 1000
    : undefined
  const payload: LicensePayload = {
    schema: 'abdokofta.license.v1',
    licenseId: randomUUID(),
    customerName: cleanOptional(params.customerName),
    storeName: cleanOptional(params.storeName),
    appId: params.request.appId,
    hwid: params.request.hwid,
    features: params.features?.length ? params.features : ['offline-pos'],
    issuedAt,
    expiresAt
  }
  const signature = sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString('base64')
  const licenseText = JSON.stringify({ payload, signature }, null, 2)
  return { payload, signature, licenseText }
}

export async function supabaseInsert(table: string, rows: unknown[]): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!shouldUseSupabase() || !supabaseUrl || !serviceKey) {
    writeLocalRows(table, rows)
    return
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      prefer: 'return=minimal'
    },
    body: JSON.stringify(rows)
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Supabase insert failed for ${table}: ${response.status} ${detail}`)
  }
}

export async function supabaseSelect<T>(path: string): Promise<T[]> {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!shouldUseSupabase() || !supabaseUrl || !serviceKey) return readLocalRows<T>(path)

  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`
    }
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Supabase query failed: ${response.status} ${detail}`)
  }
  return await response.json() as T[]
}

export function activationStorageMode(): 'supabase' | 'local-json' {
  return shouldUseSupabase() ? 'supabase' : 'local-json'
}

export function requestMeta(req: VercelRequest): { ip: string; userAgent: string } {
  const forwarded = firstHeader(req.headers['x-forwarded-for'])
  return {
    ip: forwarded?.split(',')[0]?.trim() || firstHeader(req.headers['x-real-ip']) || '',
    userAgent: firstHeader(req.headers['user-agent']) || ''
  }
}

export function handleApiError(res: VercelResponse, error: unknown): void {
  const statusCode = typeof error === 'object' && error && 'statusCode' in error
    ? Number((error as { statusCode?: number }).statusCode)
    : 500
  res.status(Number.isFinite(statusCode) ? statusCode : 500).json({
    ok: false,
    error: error instanceof Error ? error.message : 'Unexpected error'
  })
}

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function shouldUseSupabase(): boolean {
  const mode = process.env.ACTIVATION_SITE_STORAGE_MODE?.trim().toLowerCase()
  if (mode === 'local' || mode === 'local-json' || mode === 'offline') return false
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

function localStorePath(): string {
  return process.env.ACTIVATION_SITE_LOCAL_STORE_PATH
    ? process.env.ACTIVATION_SITE_LOCAL_STORE_PATH
    : join(process.cwd(), '.local-data', 'activation-site.json')
}

function emptyLocalStore(): LocalStore {
  return {
    license_activations: [],
    activation_site_events: []
  }
}

function memoryStore(): LocalStore {
  const globalStore = globalThis as typeof globalThis & { __SHIFT_POS_ACTIVATION_STORE__?: LocalStore }
  if (!globalStore.__SHIFT_POS_ACTIVATION_STORE__) {
    globalStore.__SHIFT_POS_ACTIVATION_STORE__ = emptyLocalStore()
  }
  return globalStore.__SHIFT_POS_ACTIVATION_STORE__
}

function readLocalStore(): LocalStore {
  const fallback = memoryStore()
  const path = localStorePath()
  try {
    if (!existsSync(path)) return fallback
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<LocalStore>
    fallback.license_activations = Array.isArray(parsed.license_activations) ? parsed.license_activations : []
    fallback.activation_site_events = Array.isArray(parsed.activation_site_events) ? parsed.activation_site_events : []
  } catch {
    // Keep the in-memory store usable if the local JSON file is unavailable.
  }
  return fallback
}

function writeLocalStore(store: LocalStore): void {
  const path = localStorePath()
  const globalStore = memoryStore()
  globalStore.license_activations = store.license_activations
  globalStore.activation_site_events = store.activation_site_events
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(store, null, 2), 'utf8')
  } catch {
    // Vercel functions may not have durable writable storage; in-memory fallback is enough there.
  }
}

function writeLocalRows(table: string, rows: unknown[]): void {
  const tableName = localTableName(table)
  if (!tableName) return
  const store = readLocalStore()
  store[tableName].unshift(...rows)
  writeLocalStore(store)
}

function readLocalRows<T>(path: string): T[] {
  const tableName = localTableName(path)
  if (!tableName) return []
  const limit = Number(path.match(/(?:\?|&)limit=(\d+)/)?.[1] ?? 100)
  return readLocalStore()[tableName]
    .slice()
    .sort(compareCreatedAtDesc)
    .slice(0, Number.isFinite(limit) ? limit : 100) as T[]
}

function localTableName(value: string): LocalTable | null {
  if (value.startsWith('license_activations')) return 'license_activations'
  if (value.startsWith('activation_site_events')) return 'activation_site_events'
  return null
}

function compareCreatedAtDesc(left: unknown, right: unknown): number {
  const leftTime = Date.parse(String((left as { created_at?: unknown }).created_at ?? ''))
  const rightTime = Date.parse(String((right as { created_at?: unknown }).created_at ?? ''))
  return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0)
}
