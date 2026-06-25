/**
 * Audit log service — REQ-7.
 *
 * Every significant system action is recorded here.
 * Entries are written to SQLite and queued for optional master-device API sync.
 * Entries are NEVER modified or deleted — append-only.
 */
import type { AppSettings, AppUser, AuditAction, AuditEntry, EmployeeActivityLog } from '@shared/types'
import { COLLECTIONS, SETTINGS_DOC_ID } from '@shared/constants/collections'
import { cacheDocs, getCachedDoc, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { generateId } from '@renderer/lib/utils/id'

export interface AuditActor {
  id: string
  username?: string
  displayName?: string
}

export function actorAuditName(actor: AuditActor): string {
  return actor.username?.trim() || actor.displayName?.trim() || actor.id
}

export function describePatch(patch: Record<string, unknown>): string {
  const entries = Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      if (typeof value === 'boolean') return `${key}: ${value ? 'نعم' : 'لا'}`
      if (Array.isArray(value)) return `${key}: ${value.length} عنصر`
      if (value && typeof value === 'object') return `${key}: تم التعديل`
      return `${key}: ${String(value)}`
    })
  return entries.length ? entries.join('، ') : 'بدون تفاصيل'
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Append an audit entry. Fire-and-forget safe — errors are swallowed so
 * a logging failure never blocks a business operation.
 */
export async function logAudit(params: {
  action: AuditAction
  actorId: string
  actorName: string
  targetId?: string
  targetType?: AuditEntry['targetType']
  detailAr: string
}): Promise<void> {
  try {
    const entry: AuditEntry = {
      id: generateId(),
      action: params.action,
      actorId: params.actorId,
      actorName: params.actorName,
      targetId: params.targetId,
      targetType: params.targetType,
      detailAr: params.detailAr,
      createdAt: Date.now()
    }
    await cacheDocs(COLLECTIONS.auditLog, [entry])
    await recordEmployeeActivity(params, entry.createdAt)
  } catch {
    // Audit failure must never break the calling operation
  }
}

async function recordEmployeeActivity(
  params: {
    action: AuditAction
    actorId: string
    actorName: string
    targetId?: string
    detailAr: string
  },
  createdAt: number
): Promise<void> {
  if (!params.actorId || params.actorId === 'system') return
  const settings = await getCachedDoc<AppSettings>(COLLECTIONS.settings, SETTINGS_DOC_ID)
  if (settings?.employeePerformanceTrackingEnabled !== true) return

  const user = await getCachedDoc<AppUser>(COLLECTIONS.users, params.actorId)
  const network = await window.electronAPI.getNetworkStatus().catch(() => null) as {
    mode?: string
    side?: { deviceName?: string }
  } | null
  const log: EmployeeActivityLog = {
    id: generateId(),
    userId: params.actorId,
    username: user?.username?.trim() || params.actorName || params.actorId,
    actionType: params.action,
    referenceId: params.targetId,
    deviceId: network?.side?.deviceName?.trim() || (network?.mode === 'side' ? 'Side POS' : 'Master POS'),
    detailAr: params.detailAr,
    createdAt
  }
  await cacheDocs(COLLECTIONS.employeeActivityLogs, [log])
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export type AuditDateRange = 'today' | 'week' | 'month' | 'all'

function rangeStart(range: AuditDateRange): number {
  const now = Date.now()
  if (range === 'today') {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  if (range === 'week') return now - 7 * 24 * 60 * 60 * 1000
  if (range === 'month') return now - 30 * 24 * 60 * 60 * 1000
  return 0
}

export async function listAuditEntries(range: AuditDateRange = 'today'): Promise<AuditEntry[]> {
  const start = rangeStart(range)
  const all = await getCachedDocs<AuditEntry>(COLLECTIONS.auditLog)
  return all
    .filter((e) => e.createdAt >= start)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 500)
}
