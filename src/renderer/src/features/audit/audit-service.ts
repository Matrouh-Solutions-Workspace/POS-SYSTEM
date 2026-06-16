/**
 * Audit log service — REQ-7.
 *
 * Every significant system action is recorded here.
 * Entries are written to SQLite (synced to Firebase via outbox).
 * Entries are NEVER modified or deleted — append-only.
 */
import type { AuditAction, AuditEntry } from '@shared/types'
import { COLLECTIONS } from '@shared/constants/collections'
import { cacheDocs, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { generateId } from '@renderer/lib/utils/id'

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
  } catch {
    // Audit failure must never break the calling operation
  }
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
