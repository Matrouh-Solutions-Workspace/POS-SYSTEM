import { randomUUID, sign, timingSafeEqual } from 'node:crypto'

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
  if (!supabaseUrl || !serviceKey) return

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
  const supabaseUrl = getEnv('SUPABASE_URL')
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')
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
