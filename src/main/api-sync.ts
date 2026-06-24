import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { getLicenseStatus } from './license'
import {
  isMasterStoreMode,
  markOutboxFailed,
  markOutboxSynced,
  readPendingOutbox,
  resetFailedOutbox,
  type OutboxEntry
} from './local-store'
import { isSideMode } from './network-config'

declare const __API_SYNC_ENABLED__: string
declare const __API_SYNC_URL__: string
declare const __API_SYNC_TOKEN__: string

export interface ApiSyncResult {
  ok: boolean
  enabled: boolean
  uploaded: number
  failed: number
  pending: number
  skipped?: 'disabled' | 'not_master' | 'invalid_license' | 'empty'
  error?: string
}

interface PushResponse {
  accepted: string[]
  rejected?: Array<{ id: string; code?: string; message?: string; retryable?: boolean }>
}

function configValue(runtimeName: string, builtValue: string): string {
  return process.env[runtimeName]?.trim() || builtValue.trim()
}

function syncEnabled(): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    configValue('API_SYNC_ENABLED', __API_SYNC_ENABLED__).toLowerCase()
  )
}

function parsePayload(entry: OutboxEntry): unknown {
  try {
    return JSON.parse(entry.payload_json) as unknown
  } catch {
    return entry.payload_json
  }
}

function validateResponse(value: unknown): PushResponse {
  if (!value || typeof value !== 'object') throw new Error('API returned an invalid sync response')
  const response = value as Partial<PushResponse>
  if (!Array.isArray(response.accepted) || !response.accepted.every((id) => typeof id === 'string')) {
    throw new Error('API response must contain an accepted operation ID array')
  }
  if (
    response.rejected !== undefined &&
    (!Array.isArray(response.rejected) ||
      !response.rejected.every((item) => item && typeof item.id === 'string'))
  ) {
    throw new Error('API response contains an invalid rejected operation array')
  }
  return response as PushResponse
}

export async function pushOutboxToApi(): Promise<ApiSyncResult> {
  if (!syncEnabled()) {
    return { ok: true, enabled: false, uploaded: 0, failed: 0, pending: 0, skipped: 'disabled' }
  }
  if (isSideMode() || !isMasterStoreMode()) {
    return { ok: true, enabled: true, uploaded: 0, failed: 0, pending: 0, skipped: 'not_master' }
  }

  const licenseStatus = getLicenseStatus()
  const licenseId = licenseStatus.license?.licenseId?.trim()
  if (!licenseStatus.valid || !licenseId) {
    return {
      ok: false,
      enabled: true,
      uploaded: 0,
      failed: 0,
      pending: 0,
      skipped: 'invalid_license',
      error: licenseStatus.reason || 'A valid master license ID is required for API sync'
    }
  }

  const endpoint = configValue('API_SYNC_URL', __API_SYNC_URL__)
  if (!endpoint) {
    return {
      ok: false,
      enabled: true,
      uploaded: 0,
      failed: 0,
      pending: 0,
      error: 'API_SYNC_URL is required when API_SYNC_ENABLED is true'
    }
  }

  resetFailedOutbox()
  const pending = readPendingOutbox()
  if (!pending.length) {
    return { ok: true, enabled: true, uploaded: 0, failed: 0, pending: 0, skipped: 'empty' }
  }

  const requestId = randomUUID()
  const token = configValue('API_SYNC_TOKEN', __API_SYNC_TOKEN__)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Idempotency-Key': requestId,
    'X-License-ID': licenseId,
    'X-Device-ID': licenseStatus.hwid
  }
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        schema: 'shift-pos.sync.push.v1',
        requestId,
        licenseId,
        deviceId: licenseStatus.hwid,
        appVersion: app.getVersion(),
        sentAt: Date.now(),
        operations: pending.map((entry) => ({
          id: entry.id,
          entityType: entry.entity_type,
          entityId: entry.entity_id,
          operation: entry.operation,
          payload: parsePayload(entry),
          createdAt: entry.created_at,
          attempts: entry.attempts
        }))
      })
    })

    const raw = await response.text()
    if (!response.ok) {
      throw new Error(`API sync failed with HTTP ${response.status}${raw ? `: ${raw.slice(0, 300)}` : ''}`)
    }

    const result = validateResponse(raw ? JSON.parse(raw) as unknown : null)
    const pendingIds = new Set(pending.map((entry) => entry.id))
    const acceptedIds = Array.from(new Set(result.accepted)).filter((id) => pendingIds.has(id))
    const acceptedSet = new Set(acceptedIds)
    const rejectedIds = Array.from(new Set((result.rejected ?? []).map((item) => item.id)))
      .filter((id) => pendingIds.has(id) && !acceptedSet.has(id))
    const acknowledged = new Set([...acceptedIds, ...rejectedIds])
    const unacknowledgedIds = pending.map((entry) => entry.id).filter((id) => !acknowledged.has(id))
    const failedIds = [...rejectedIds, ...unacknowledgedIds]

    markOutboxSynced(acceptedIds)
    markOutboxFailed(failedIds)

    return {
      ok: failedIds.length === 0,
      enabled: true,
      uploaded: acceptedIds.length,
      failed: failedIds.length,
      pending: failedIds.length,
      error: failedIds.length ? 'The API did not accept every queued operation' : undefined
    }
  } catch (error) {
    const ids = pending.map((entry) => entry.id)
    markOutboxFailed(ids)
    return {
      ok: false,
      enabled: true,
      uploaded: 0,
      failed: ids.length,
      pending: ids.length,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
