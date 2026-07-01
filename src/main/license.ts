import { app, dialog } from 'electron'
import { createHash, randomBytes, verify } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname, cpus, platform } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

declare const __LICENSE_PUBLIC_KEY__: string

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
const DEV_ACTIVATION_CODE = 'wanrltw153'
const DEV_SIGNATURE_PREFIX = 'dev-sha256:'

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

function devLicenseSignature(payload: LicensePayload): string {
  return `${DEV_SIGNATURE_PREFIX}${createHash('sha256')
    .update(`${DEV_ACTIVATION_CODE}|${canonicalJson(payload)}`)
    .digest('hex')}`
}

function isValidDevLicense(license: LicenseFile): boolean {
  return license.signature === devLicenseSignature(license.payload)
}

function licensePublicKey(): string {
  const key = __LICENSE_PUBLIC_KEY__.replace(/\\n/g, '\n').trim()
  if (!key) throw new Error('مفتاح التحقق من الرخصة غير مضبوط في إعدادات التشغيل')
  return key
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

  if (!existsSync(path)) {
    return { valid: false, reason: 'لم يتم تفعيل التطبيق', hwid, licensePath: path }
  }

  try {
    const license = parseLicenseFile(readFileSync(path, 'utf8'))
    const ok = isValidDevLicense(license) || verify(
      null,
      Buffer.from(canonicalJson(license.payload)),
      licensePublicKey(),
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

  writeFileSync(licensePath(), JSON.stringify({
    payload,
    signature: devLicenseSignature(payload)
  }, null, 2), 'utf8')

  return { ok: true, status: getLicenseStatus() }
}
