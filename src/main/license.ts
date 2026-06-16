import { app, dialog } from 'electron'
import { createHash, randomBytes, verify } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, cpus, platform } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

// SHA-256 of the master activation key "yecgaa123@"
// Generated with: node -e "const c=require('crypto');console.log(c.createHash('sha256').update('yecgaa123@').digest('hex'))"
const MASTER_KEY_HASH = '6c79e238d59dfc64a86988042e3cf84e179574d37bffaaa76dc2cd9211612fb5'

const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA6a1H+875wp9OrSjSzdgsiufVmclxnQlaY5kAHn+Fmio=
-----END PUBLIC KEY-----`

export interface ActivationRequest {
  schema: 'abdokofta.activation-request.v1'
  appId: string
  appVersion: string
  hwid: string
  machine: {
    platform: string
    hostname: string
  }
  nonce: string
  createdAt: number
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

interface LicenseFile {
  payload: LicensePayload
  signature: string
}

export interface LicenseStatus {
  valid: boolean
  reason?: string
  license?: LicensePayload
  hwid: string
  licensePath: string
}

const APP_ID = 'com.shift.pos'

// ---------------------------------------------------------------------------
// Dev-mode bypass flag
// A small sentinel file written next to license.dat.
// No valid signature needed — only works in dev (electron-vite dev mode).
// ---------------------------------------------------------------------------

function devBypassPath(): string {
  return join(app.getPath('userData'), 'dev-license-bypass.flag')
}

/** Returns true when the dev bypass flag is present on disk and not expired */
export function isDevBypassActive(): boolean {
  const bp = devBypassPath()
  if (!existsSync(bp)) return false
  try {
    const data = JSON.parse(readFileSync(bp, 'utf8')) as { expiresAt?: number }
    if (data.expiresAt && Date.now() > data.expiresAt) {
      // Expired — clean it up automatically
      rmSync(bp, { force: true })
      return false
    }
    return true
  } catch {
    return true // malformed flag → treat as active (no expiry info)
  }
}

/**
 * Toggle dev license:
 *  - If real license.dat exists → delete it (app shows activation screen on next launch)
 *  - If dev-bypass flag exists  → delete it (same effect)
 *  - Otherwise                  → write the bypass flag (app boots as activated)
 * Returns a human-readable message describing what happened.
 */
export function toggleDevLicense(): string {
  const lp = licensePath()
  const bp = devBypassPath()

  if (existsSync(lp)) {
    rmSync(lp, { force: true })
    return 'license.dat deleted — app will show activation screen on next launch'
  }
  if (existsSync(bp)) {
    rmSync(bp, { force: true })
    return 'Dev bypass removed — app will show activation screen on next launch'
  }
  writeFileSync(bp, JSON.stringify({ createdAt: Date.now(), note: 'dev-only bypass' }), 'utf8')
  return 'Dev bypass activated — app will boot without license check'
}

function licensePath(): string {
  return join(app.getPath('userData'), 'license.dat')
}

function windowsMachineGuid(): string {
  if (process.platform !== 'win32') return ''
  try {
    const output = execFileSync('reg', [
      'query',
      'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
      '/v',
      'MachineGuid'
    ], { encoding: 'utf8', windowsHide: true })
    const match = output.match(/MachineGuid\s+REG_SZ\s+(.+)/i)
    return match?.[1]?.trim() ?? ''
  } catch {
    return ''
  }
}

export function getHardwareId(): string {
  const fingerprint = [
    platform(),
    hostname(),
    windowsMachineGuid(),
    cpus()[0]?.model ?? ''
  ].join('|')
  return createHash('sha256').update(fingerprint).digest('hex')
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value)
}

function parseLicenseFile(raw: string): LicenseFile {
  const parsed = JSON.parse(raw) as LicenseFile
  if (!parsed.payload || !parsed.signature) {
    throw new Error('license.dat غير صالح')
  }
  return parsed
}

export function getLicenseStatus(): LicenseStatus {
  const hwid = getHardwareId()
  const path = licensePath()

  // Dev bypass — skip all signature checks
  if (isDevBypassActive()) {
    const bp = devBypassPath()
    let expiresAt: number | undefined
    try {
      const data = JSON.parse(readFileSync(bp, 'utf8')) as { expiresAt?: number }
      expiresAt = data.expiresAt
    } catch { /* ignore */ }

    return {
      valid: true,
      license: {
        schema: 'abdokofta.license.v1',
        licenseId: 'master-key',
        customerName: 'Trial',
        appId: APP_ID,
        hwid,
        features: ['offline-pos'],
        issuedAt: Date.now(),
        expiresAt
      },
      hwid,
      licensePath: path
    }
  }

  if (!existsSync(path)) {
    return { valid: false, reason: 'لم يتم تفعيل التطبيق', hwid, licensePath: path }
  }

  try {
    const license = parseLicenseFile(readFileSync(path, 'utf8'))
    const ok = verify(
      null,
      Buffer.from(canonicalJson(license.payload)),
      LICENSE_PUBLIC_KEY,
      Buffer.from(license.signature, 'base64')
    )
    if (!ok) return { valid: false, reason: 'توقيع الرخصة غير صحيح', hwid, licensePath: path }
    if (license.payload.appId !== APP_ID) {
      return { valid: false, reason: 'الرخصة ليست لهذا التطبيق', hwid, licensePath: path }
    }
    if (license.payload.hwid !== hwid) {
      return { valid: false, reason: 'الرخصة ليست لهذا الجهاز', hwid, licensePath: path }
    }
    if (license.payload.expiresAt && Date.now() > license.payload.expiresAt) {
      return { valid: false, reason: 'انتهت صلاحية الرخصة', hwid, licensePath: path }
    }
    return { valid: true, license: license.payload, hwid, licensePath: path }
  } catch (e) {
    return {
      valid: false,
      reason: e instanceof Error ? e.message : 'فشل قراءة الرخصة',
      hwid,
      licensePath: path
    }
  }
}

export async function createActivationRequestFile(): Promise<{ ok: boolean; path?: string; error?: string }> {
  const request: ActivationRequest = {
    schema: 'abdokofta.activation-request.v1',
    appId: APP_ID,
    appVersion: app.getVersion(),
    hwid: getHardwareId(),
    machine: {
      platform: platform(),
      hostname: hostname()
    },
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
  const source = result.filePaths[0]!
  const raw = readFileSync(source, 'utf8')
  parseLicenseFile(raw)
  writeFileSync(licensePath(), raw, 'utf8')
  return { ok: true, status: getLicenseStatus() }
}

/**
 * Activate using the master key (works in production).
 * The key is compared against its SHA-256 hash — plaintext never stored.
 * On success writes the dev-bypass flag with a 7-day expiry.
 */
export function activateMasterKey(key: string): { ok: boolean; error?: string } {
  const hash = createHash('sha256').update(key.trim()).digest('hex')
  if (hash !== MASTER_KEY_HASH) {
    return { ok: false, error: 'المفتاح غير صحيح' }
  }
  try {
    const lp = licensePath()
    if (existsSync(lp)) rmSync(lp, { force: true })

    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
    writeFileSync(
      devBypassPath(),
      JSON.stringify({ createdAt: Date.now(), expiresAt, note: 'master-key activation' }),
      'utf8'
    )
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
