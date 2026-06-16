/**
 * SQLite cache helpers — thin wrappers used by all service files.
 * REQ-13: Removed dead no-op functions (mergeLocalFirst, mergeAndCacheLocalFirst,
 * mergeDocAndCacheLocalFirst, isAppOffline, isOfflineError).
 */
import { dbDelete, dbGet, dbGetAll, dbSave } from '@renderer/lib/db/sqlite-db'

// ---------------------------------------------------------------------------
// Document helpers
// ---------------------------------------------------------------------------

export async function cacheDocs<T extends { id: string }>(
  collectionName: string,
  docs: T[]
): Promise<void> {
  await dbSave(collectionName, docs)
}

export async function getCachedDocs<T>(collectionName: string): Promise<T[]> {
  return dbGetAll<T>(collectionName)
}

export async function getCachedDoc<T>(
  collectionName: string,
  documentId: string
): Promise<T | null> {
  return dbGet<T>(collectionName, documentId)
}

export async function deleteCachedDoc(
  collectionName: string,
  documentId: string
): Promise<void> {
  await dbDelete(collectionName, documentId)
}
