import { app, dialog } from 'electron'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  verify
} from 'node:crypto'
import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { hostname, cpus, platform } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

// Injected at build time from .env
declare const __LICENSE_PUBLIC_KEY__: string
declare const __LICENSE_ENCRYPT_KEY__: string
declare const __ACTIVATION_SERVER_URL__: string

// ─── Constants ───────────────────────────────────────────────────────────────

const APP_ID = 'com.shift.pos'
const DEV_ACTIVATION_CODE = 'wanrltw153'
const DEV_SIGNATURE_PREFIX = 'dev-sha256:'

/** Max clock skew before we require online re-validation (ms) */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000         // 5 minutes backward
/** How long between periodic server validations (ms) */
const VALIDATION_INTERVAL_MS = 24 * 60 * 60 * 1000  // 24 hours

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface ActivationRequest {
  schema: 'abdokofta.activation-request.v1'
  appId: string
  appVersion: string
  hwid: string
  machine: { platform: string; hostname: string }
  nonce: string
  createdAt: number
}

export interface LicensePayload {
  schema: 'abdokofta.license.v1'
  licenseId: string
  licenseKey?: string
  customerName?: string
  storeName?: string
  appId: string
  hwid: string
  features?: string[]
  issuedAt: number
  expiresAt?: number
  graceExpiresAt?: number
}

/** v2 on-disk format: encrypted blob + RSA signature. Never plain-text payload. */
interface LicenseFileV2 {
  v: 2
  blob: string       // AES-256-GCM encrypted LicensePayload: hex(iv):hex(authTag):hex(ciphertext)
  signature: string  // RSA-SHA256 over blob (base64)
}

/** v1 legacy format kept for import compatibility */
interface LicenseFileV1 {
  payload: LicensePayload
  signature: string
}

/** Metadata stored separately — never contains sensitive data */
interface LicenseMeta {
  licenseId: string
  lastValidatedAt: number   // epoch ms of last successful server validation
  lastClockCheck: number    // system clock reading at that moment
}

export interface LicenseStatus {
  valid: boolean
  reason?: string
  license?: LicensePayload
  hwid: string
  licensePath: string
  inGrace?: boolean
}

// ─── File paths ───────────────────────────────────────────────────────────────

function licensePath(): string {
  return join(app.getPath('userData'), 'license.dat')
}

function metaPath(): string {
  return join(app.getPath('userData'), 'license-meta.json')
}

// ─── Hardware fingerprint ─────────────────────────────────────────────────────

function windowsMachineGuid(): string {
  if (process.platform !== 'win32') return ''
  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { encoding: 'utf8', windowsHide: true }
    )
    return out.match(/MachineGuid\s+REG_SZ\s+(.+)/i)?.[1]?.trim() ?? ''
  } catch { return '' }
}

function diskSerial(): string {
  if (process.platform !== 'win32') return ''
  try {
    const out = execFileSync(
      'wmic',
      ['diskdrive', 'get', 'SerialNumber'],
      { encoding: 'utf8', windowsHide: true }
    )
    const lines = out.split('\n').map((l) => l.trim()).filter(Boolean)
    return lines[1] ?? ''
  } catch { return '' }
}

export function getHardwareId(): string {
  const fingerprint = [
    platform(),
    hostname(),
    windowsMachineGuid(),
    cpus()[0]?.model ?? '',
    diskSerial()
  ].join('|')
  return createHash('sha256').update(fingerprint).digest('hex')
}

// ─── Encryption helpers (AES-256-GCM) ────────────────────────────────────────

function encryptionKey(): Buffer {
  const raw = __LICENSE_ENCRYPT_KEY__ || __LICENSE_PUBLIC_KEY__
  if (!raw) throw new Error('License encryption key not configured')
  return createHash('sha256').update(raw).digest()
}

function encryptPayload(payload: LicensePayload): string {
  const key = encryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

function decryptPayload(blob: string): LicensePayload {
  const parts = blob.split(':')
  if (parts.length !== 3) throw new Error('Invalid license blob')
  const [ivHex, tagHex, ctHex] = parts as [string, string, string]
  const key = encryptionKey()
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  const plain = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()])
  return JSON.parse(plain.toString('utf8')) as LicensePayload
}

// ─── Dev license (offline, dev only) ─────────────────────────────────────────

function devLicenseSignature(payload: LicensePayload): string {
  return `${DEV_SIGNATURE_PREFIX}${createHash('sha256')
    .update(`${DEV_ACTIVATION_CODE}|${JSON.stringify(payload)}`)
    .digest('hex')}`
}

function isValidDevLicenseV1(file: LicenseFileV1): boolean {
  return file.signature === devLicenseSignature(file.payload)
}

// ─── License file parsing ─────────────────────────────────────────────────────

function publicKey(): string {
  const key = __LICENSE_PUBLIC_KEY__.replace(/\\n/g, '\n').trim()
  if (!key) throw new Error('License public key not configured')
  return key
}

/**
 * Parse and verify a license file.
 * Supports both v2 (encrypted blob) and v1 (legacy plain-text payload).
 * Returns the decrypted payload — never writes it back to disk.
 */
function parseLicenseFile(raw: string): { payload: LicensePayload; isDevLicense: boolean } {
  const parsed = JSON.parse(raw) as Partial<LicenseFileV2 & LicenseFileV1>

  // ── v2 encrypted format ──
  if (parsed.v === 2 && typeof parsed.blob === 'string' && typeof parsed.signature === 'string') {
    const blob = parsed.blob
    const sig = parsed.signature

    // Verify RSA signature over the blob string
    const ok = verify(null, Buffer.from(blob), publicKey(), Buffer.from(sig, 'base64'))
    if (!ok) throw new Error('توقيع الرخصة غير صحيح')

    const payload = decryptPayload(blob)
    return { payload, isDevLicense: false }
  }

  // ── v1 legacy plain-text format ──
  if (parsed.payload && typeof parsed.signature === 'string') {
    const file = parsed as LicenseFileV1

    if (isValidDevLicenseV1(file)) {
      return { payload: file.payload, isDevLicense: true }
    }

    const ok = verify(
      null,
      Buffer.from(JSON.stringify(file.payload)),
      publicKey(),
      Buffer.from(file.signature, 'base64')
    )
    if (!ok) throw new Error('توقيع الرخصة غير صحيح')
    return { payload: file.payload, isDevLicense: false }
  }

  throw new Error('license.dat غير صالح')
}

// ─── Meta (last-validation timestamp) ────────────────────────────────────────

function readMeta(): LicenseMeta | null {
  try {
    const path = metaPath()
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8')) as LicenseMeta
  } catch { return null }
}

function writeMeta(meta: LicenseMeta): void {
  try {
    writeFileSync(metaPath(), JSON.stringify(meta), 'utf8')
  } catch { /* non-fatal */ }
}

// ─── Clock tamper detection ───────────────────────────────────────────────────

/**
 * Returns true if the system clock appears to have been moved significantly
 * backward since the last successful validation.
 */
function clockAppearsRewound(meta: LicenseMeta): boolean {
  const now = Date.now()
  const skew = meta.lastClockCheck - now   // positive = clock went backward
  return skew > MAX_CLOCK_SKEW_MS
}

// ─── getLicenseStatus ─────────────────────────────────────────────────────────

export function getLicenseStatus(): LicenseStatus {
  const hwid = getHardwareId()
  const path = licensePath()

  if (!existsSync(path)) {
    return { valid: false, reason: 'لم يتم تفعيل التطبيق', hwid, licensePath: path }
  }

  try {
    const { payload, isDevLicense } = parseLicenseFile(readFileSync(path, 'utf8'))

    if (!isDevLicense && payload.appId !== APP_ID) {
      return { valid: false, reason: 'الرخصة ليست لهذا التطبيق', hwid, licensePath: path }
    }
    if (!isDevLicense && payload.hwid !== hwid) {
      return { valid: false, reason: 'الرخصة ليست لهذا الجهاز', hwid, licensePath: path }
    }

    const now = Date.now()

    // Clock tamper check
    const meta = readMeta()
    if (meta && !isDevLicense && clockAppearsRewound(meta)) {
      return {
        valid: false,
        reason: 'تم رصد تلاعب في ساعة الجهاز. يرجى الاتصال بالإنترنت للتحقق من الرخصة.',
        hwid,
        licensePath: path
      }
    }

    // Fully expired (past grace)
    if (payload.graceExpiresAt && now > payload.graceExpiresAt) {
      return { valid: false, reason: 'انتهت صلاحية الرخصة وفترة السماح', hwid, licensePath: path }
    }
    // Legacy hard expiry (no grace field)
    if (!payload.graceExpiresAt && payload.expiresAt && now > payload.expiresAt) {
      return { valid: false, reason: 'انتهت صلاحية الرخصة', hwid, licensePath: path }
    }

    const inGrace = Boolean(
      payload.expiresAt &&
      now > payload.expiresAt &&
      payload.graceExpiresAt &&
      now <= payload.graceExpiresAt
    )

    return { valid: true, license: payload, hwid, licensePath: path, inGrace }
  } catch (e) {
    return {
      valid: false,
      reason: e instanceof Error ? e.message : 'فشل قراءة الرخصة',
      hwid,
      licensePath: path
    }
  }
}

// ─── Periodic server validation ───────────────────────────────────────────────

let validationTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Contact the activation server to validate the license and receive a
 * freshly signed license blob. Replaces the on-disk license if successful.
 */
export async function validateWithServer(): Promise<{ ok: boolean; inGrace?: boolean; error?: string }> {
  const serverUrl = __ACTIVATION_SERVER_URL__?.trim().replace(/\/+$/, '')
  if (!serverUrl) return { ok: false, error: 'Activation server URL not configured' }

  const path = licensePath()
  if (!existsSync(path)) return { ok: false, error: 'No license file' }

  let licenseId: string
  try {
    const { payload } = parseLicenseFile(readFileSync(path, 'utf8'))
    licenseId = payload.licenseId
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to read license' }
  }

  try {
    const response = await fetch(`${serverUrl}/api/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        licenseId,
        hwid: getHardwareId(),
        appId: APP_ID,
        appVersion: app.getVersion()
      }),
      signal: AbortSignal.timeout(15_000)
    })

    const data = await response.json() as {
      ok: boolean
      licenseText?: string
      inGrace?: boolean
      action?: string
      error?: string
    }

    if (!response.ok || !data.ok) {
      // Server explicitly says deactivate
      if (data.action === 'deactivate') {
        deactivateLicense()
        // Notify renderer to kick user to activation screen
        const { BrowserWindow } = await import('electron')
        BrowserWindow.getAllWindows().forEach((w) => {
          w.webContents.send('license:revoked', data.error ?? 'تم إلغاء الرخصة من الخادم')
        })
      }
      return { ok: false, error: data.error ?? `Server error ${response.status}` }
    }

    // Replace on-disk license with fresh signed blob
    if (data.licenseText) {
      writeFileSync(path, data.licenseText, 'utf8')
    }

    const now = Date.now()
    writeMeta({ licenseId, lastValidatedAt: now, lastClockCheck: now })

    return { ok: true, inGrace: data.inGrace ?? false }
  } catch (e) {
    // Network failure — allow offline grace, don't deactivate
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Network error during validation'
    }
  }
}

/**
 * Validate with server on startup.
 * Returns 'ok', 'offline' (no internet, allow grace), or 'revoked' (deactivate).
 */
export async function validateOnStartup(): Promise<'ok' | 'offline' | 'revoked'> {
  const serverUrl = __ACTIVATION_SERVER_URL__?.trim().replace(/\/+$/, '')
  if (!serverUrl) return 'offline'   // no server configured — allow offline

  const path = licensePath()
  if (!existsSync(path)) return 'revoked'

  let licenseId: string
  try {
    const { payload } = parseLicenseFile(readFileSync(path, 'utf8'))
    licenseId = payload.licenseId
  } catch { return 'revoked' }

  try {
    const response = await fetch(`${serverUrl}/api/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        licenseId,
        hwid: getHardwareId(),
        appId: APP_ID,
        appVersion: app.getVersion()
      }),
      signal: AbortSignal.timeout(10_000)
    })

    const data = await response.json() as {
      ok: boolean
      licenseText?: string
      action?: string
      error?: string
    }

    if (!response.ok || !data.ok) {
      // Server says deactivate (revoked, wrong HWID, expired past grace)
      if (data.action === 'deactivate') {
        deactivateLicense()
        return 'revoked'
      }
      // Any other server error — treat as offline to avoid false positives
      return 'offline'
    }

    // Update license blob with fresh signed version
    if (data.licenseText) {
      writeFileSync(path, data.licenseText, 'utf8')
    }

    const now = Date.now()
    writeMeta({ licenseId, lastValidatedAt: now, lastClockCheck: now })
    return 'ok'
  } catch {
    // Network unreachable — allow offline grace
    return 'offline'
  }
}


export function startPeriodicValidation(): void {
  if (validationTimer) return

  function schedule(): void {
    validationTimer = setTimeout(() => {
      void validateWithServer().then(() => {
        schedule() // always reschedule regardless of result
      })
    }, VALIDATION_INTERVAL_MS)
  }

  schedule()
}

export function stopPeriodicValidation(): void {
  if (validationTimer) {
    clearTimeout(validationTimer)
    validationTimer = null
  }
}

// ─── Activation methods ───────────────────────────────────────────────────────

export async function createActivationRequestFile(): Promise<{ ok: boolean; path?: string; error?: string }> {
  const request: ActivationRequest = {
    schema: 'abdokofta.activation-request.v1',
    appId: APP_ID,
    appVersion: app.getVersion(),
    hwid: getHardwareId(),
    machine: { platform: platform(), hostname: hostname() },
    nonce: randomBytes(16).toString('hex'),
    createdAt: Date.now()
  }
  const result = await dialog.showSaveDialog({
    title: 'حفظ طلب التفعيل',
    defaultPath: 'activation_request.dat',
    filters: [{ name: 'Activation request', extensions: ['dat'] }]
  })
  if (result.canceled || !result.filePath) return { ok: false, error: 'تم الإلغاء' }
  writeFileSync(result.filePath, JSON.stringify(request, null, 2), 'utf8')
  return { ok: true, path: result.filePath }
}

export async function importLicenseFile(): Promise<{ ok: boolean; status?: LicenseStatus; error?: string }> {
  const result = await dialog.showOpenDialog({
    title: 'اختيار ملف الرخصة',
    filters: [{ name: 'License', extensions: ['dat'] }],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return { ok: false, error: 'تم الإلغاء' }
  const raw = readFileSync(result.filePaths[0]!, 'utf8')
  // Validate before saving
  const { payload } = parseLicenseFile(raw)
  writeFileSync(licensePath(), raw, 'utf8')
  const now = Date.now()
  writeMeta({ licenseId: payload.licenseId, lastValidatedAt: now, lastClockCheck: now })
  return { ok: true, status: getLicenseStatus() }
}

/**
 * Online activation: send a license key + HWID to the server and
 * receive a signed encrypted license blob back.
 */
export async function activateWithLicenseKey(licenseKey: string): Promise<{ ok: boolean; status?: LicenseStatus; error?: string }> {
  const serverUrl = __ACTIVATION_SERVER_URL__?.trim().replace(/\/+$/, '')
  if (!serverUrl) return { ok: false, error: 'Activation server URL not configured' }

  try {
    const response = await fetch(`${serverUrl}/api/activate-key`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        licenseKey: licenseKey.trim().toUpperCase(),
        hwid: getHardwareId(),
        appId: APP_ID,
        appVersion: app.getVersion(),
        machine: { platform: platform(), hostname: hostname() }
      }),
      signal: AbortSignal.timeout(15_000)
    })

    const data = await response.json() as {
      ok: boolean
      licenseText?: string
      license?: { licenseId?: string }
      error?: string
    }

    if (!response.ok || !data.ok) {
      return { ok: false, error: data.error ?? `Server error ${response.status}` }
    }
    if (!data.licenseText) {
      return { ok: false, error: 'Server returned no license' }
    }

    writeFileSync(licensePath(), data.licenseText, 'utf8')
    const now = Date.now()
    writeMeta({
      licenseId: data.license?.licenseId ?? '',
      lastValidatedAt: now,
      lastClockCheck: now
    })

    return { ok: true, status: getLicenseStatus() }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' }
  }
}

export function deactivateLicense(): { ok: boolean; error?: string } {
  try {
    if (existsSync(licensePath())) unlinkSync(licensePath())
    if (existsSync(metaPath())) unlinkSync(metaPath())
    stopPeriodicValidation()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'فشل حذف الرخصة' }
  }
}

export function activateWithDevCode(code: string): { ok: boolean; status?: LicenseStatus; error?: string } {
  if (code.trim().toLowerCase() !== DEV_ACTIVATION_CODE) {
    return { ok: false, error: 'Invalid activation code' }
  }
  const payload: LicensePayload = {
    schema: 'abdokofta.license.v1',
    licenseId: `dev-${randomBytes(8).toString('hex')}`,
    customerName: 'Dev Activation',
    appId: APP_ID,
    hwid: getHardwareId(),
    features: ['offline-pos', 'dev-activation'],
    issuedAt: Date.now()
  }
  // v1 format for dev licenses (no server needed)
  writeFileSync(licensePath(), JSON.stringify({
    payload,
    signature: devLicenseSignature(payload)
  }, null, 2), 'utf8')
  return { ok: true, status: getLicenseStatus() }
}
