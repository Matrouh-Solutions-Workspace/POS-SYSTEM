import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_MASTER_PORT = 47831

export interface SideConnectionConfig {
  mode: 'side'
  masterUrl: string
  deviceName: string
  pairingToken: string
  pairedAt: number
}

export interface PairedDevice {
  id: string
  name: string
  token: string
  pairedAt: number
  lastSeenAt?: number
}

function sideConfigPath(): string {
  return join(app.getPath('userData'), 'side-connection.json')
}

function pairedDevicesPath(): string {
  return join(app.getPath('userData'), 'master-paired-devices.json')
}

export function normalizeMasterUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  const url = new URL(withProtocol)
  if (!url.port) url.port = String(DEFAULT_MASTER_PORT)
  return url.toString().replace(/\/+$/, '')
}

export function readSideConnection(): SideConnectionConfig | null {
  const path = sideConfigPath()
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as SideConnectionConfig
    if (parsed.mode !== 'side' || !parsed.masterUrl || !parsed.pairingToken) return null
    return parsed
  } catch {
    return null
  }
}

export function writeSideConnection(config: SideConnectionConfig): void {
  writeFileSync(sideConfigPath(), JSON.stringify(config, null, 2), 'utf8')
}

export function clearSideConnection(): void {
  rmSync(sideConfigPath(), { force: true })
}

export function isSideMode(): boolean {
  return readSideConnection() !== null
}

export function readPairedDevices(): PairedDevice[] {
  const path = pairedDevicesPath()
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PairedDevice[]
    return Array.isArray(parsed) ? parsed.filter((d) => d.id && d.token) : []
  } catch {
    return []
  }
}

export function writePairedDevices(devices: PairedDevice[]): void {
  writeFileSync(pairedDevicesPath(), JSON.stringify(devices, null, 2), 'utf8')
}

export function addPairedDevice(name: string): PairedDevice {
  const devices = readPairedDevices()
  const device: PairedDevice = {
    id: randomBytes(8).toString('hex'),
    name: name.trim() || 'Side device',
    token: randomBytes(24).toString('hex'),
    pairedAt: Date.now()
  }
  devices.push(device)
  writePairedDevices(devices)
  return device
}

export function revokePairedDevice(deviceId: string): boolean {
  const devices = readPairedDevices()
  const next = devices.filter((d) => d.id !== deviceId)
  writePairedDevices(next)
  return next.length !== devices.length
}

export function touchPairedDevice(token: string): PairedDevice | null {
  const devices = readPairedDevices()
  const device = devices.find((d) => d.token === token)
  if (!device) return null
  device.lastSeenAt = Date.now()
  writePairedDevices(devices)
  return device
}
