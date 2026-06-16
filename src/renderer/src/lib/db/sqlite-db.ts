/**
 * SQLite primary database layer.
 *
 * All reads and writes go through these helpers first.
 * Firebase is only used for background upload via the sync outbox.
 */

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export async function dbGetAll<T>(collectionName: string): Promise<T[]> {
  if (!window.electronAPI?.getCachedDocuments) return []
  return (await window.electronAPI.getCachedDocuments(collectionName)) as T[]
}

export async function dbGet<T>(collectionName: string, id: string): Promise<T | null> {
  if (!window.electronAPI?.getCachedDocument) return null
  return (await window.electronAPI.getCachedDocument(collectionName, id)) as T | null
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

/**
 * Upsert one or more documents into SQLite **and** enqueue them for Firebase upload.
 */
export async function dbSave<T extends { id: string }>(
  collectionName: string,
  docs: T | T[]
): Promise<void> {
  const arr = Array.isArray(docs) ? docs : [docs]
  if (!arr.length) return

  // 1. Write to SQLite (primary)
  await window.electronAPI.cacheDocuments(
    collectionName,
    arr.map((d) => ({ id: d.id, data: d }))
  )

  // 2. Enqueue for Firebase background upload (fire-and-forget)
  for (const doc of arr) {
    void window.electronAPI.outboxEnqueue(collectionName, doc.id, 'set', doc)
  }
}

/**
 * Delete a document from SQLite **and** enqueue the deletion for Firebase.
 */
export async function dbDelete(collectionName: string, id: string): Promise<void> {
  // 1. Delete from SQLite (primary)
  await window.electronAPI.deleteCachedDocument(collectionName, id)

  // 2. Enqueue deletion for Firebase background upload (fire-and-forget)
  void window.electronAPI.outboxEnqueue(collectionName, id, 'delete', { id })
}

// ---------------------------------------------------------------------------
// Atomic batch write
// ---------------------------------------------------------------------------

export interface DbBatchOp {
  collection: string
  id: string
  data: unknown
  op: 'set' | 'delete'
}

/**
 * Execute multiple document operations atomically in a single SQLite transaction.
 * If any operation fails the entire batch is rolled back.
 * Also enqueues all operations to the Firebase outbox inside the same transaction.
 *
 * Use this for any multi-table write (order + items + payments + inventory + cash drawer).
 */
export async function dbBatch(ops: DbBatchOp[]): Promise<void> {
  if (!ops.length) return
  const result = await window.electronAPI.executeBatch(ops)
  if (!result.ok) {
    throw new Error(result.error ?? 'فشل حفظ البيانات — تم التراجع عن العملية')
  }
}
