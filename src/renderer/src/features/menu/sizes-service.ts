/**
 * Master sizes — predefined list of size names (صغير / وسط / كبير / فاميلي …)
 * Users pick from this list when creating/editing a product instead of typing free text.
 */
import type { ItemSize } from '@shared/types'
import { COLLECTIONS } from '@shared/constants/collections'
import { cacheDocs, getCachedDoc, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { dbDelete } from '@renderer/lib/db/sqlite-db'
import { generateId } from '@renderer/lib/utils/id'

export async function listSizes(): Promise<ItemSize[]> {
  const sizes = await getCachedDocs<ItemSize>(COLLECTIONS.itemSizes)
  return sizes.sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function createSize(nameAr: string, sortOrder: number): Promise<ItemSize> {
  const now = Date.now()
  const size: ItemSize = {
    id: generateId(),
    nameAr,
    sortOrder,
    active: true,
    createdAt: now,
    updatedAt: now
  }
  await cacheDocs(COLLECTIONS.itemSizes, [size])
  return size
}

export async function updateSize(
  id: string,
  patch: Partial<Pick<ItemSize, 'nameAr' | 'sortOrder' | 'active'>>
): Promise<void> {
  const cached = await getCachedDoc<ItemSize>(COLLECTIONS.itemSizes, id)
  if (!cached) return
  await cacheDocs(COLLECTIONS.itemSizes, [{ ...cached, ...patch, updatedAt: Date.now() }])
}

export async function deleteSize(id: string): Promise<void> {
  await dbDelete(COLLECTIONS.itemSizes, id)
}

export async function reorderSizes(
  sizes: Array<{ id: string; sortOrder: number }>
): Promise<void> {
  const cached = await getCachedDocs<ItemSize>(COLLECTIONS.itemSizes)
  const sortById = new Map(sizes.map((s) => [s.id, s.sortOrder]))
  const updates = cached
    .filter((s) => sortById.has(s.id))
    .map((s) => ({ ...s, sortOrder: sortById.get(s.id) ?? s.sortOrder, updatedAt: Date.now() }))
  if (updates.length) await cacheDocs(COLLECTIONS.itemSizes, updates)
}
