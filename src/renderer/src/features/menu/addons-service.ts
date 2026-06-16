/**
 * Master add-ons — predefined list (إضافة جبنة / صوص إضافي / بطاطس / كولا …)
 * Users pick from this list when creating/editing a product instead of typing free text.
 */
import type { ItemAddon } from '@shared/types'
import { COLLECTIONS } from '@shared/constants/collections'
import { cacheDocs, getCachedDoc, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { dbDelete } from '@renderer/lib/db/sqlite-db'
import { generateId } from '@renderer/lib/utils/id'

export async function listAddons(): Promise<ItemAddon[]> {
  const addons = await getCachedDocs<ItemAddon>(COLLECTIONS.itemAddons)
  return addons.sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function createAddon(
  nameAr: string,
  defaultPrice: number,
  sortOrder: number
): Promise<ItemAddon> {
  const now = Date.now()
  const addon: ItemAddon = {
    id: generateId(),
    nameAr,
    defaultPrice,
    sortOrder,
    active: true,
    createdAt: now,
    updatedAt: now
  }
  await cacheDocs(COLLECTIONS.itemAddons, [addon])
  return addon
}

export async function updateAddon(
  id: string,
  patch: Partial<Pick<ItemAddon, 'nameAr' | 'defaultPrice' | 'sortOrder' | 'active'>>
): Promise<void> {
  const cached = await getCachedDoc<ItemAddon>(COLLECTIONS.itemAddons, id)
  if (!cached) return
  await cacheDocs(COLLECTIONS.itemAddons, [{ ...cached, ...patch, updatedAt: Date.now() }])
}

export async function deleteAddon(id: string): Promise<void> {
  await dbDelete(COLLECTIONS.itemAddons, id)
}

export async function reorderAddons(
  addons: Array<{ id: string; sortOrder: number }>
): Promise<void> {
  const cached = await getCachedDocs<ItemAddon>(COLLECTIONS.itemAddons)
  const sortById = new Map(addons.map((a) => [a.id, a.sortOrder]))
  const updates = cached
    .filter((a) => sortById.has(a.id))
    .map((a) => ({ ...a, sortOrder: sortById.get(a.id) ?? a.sortOrder, updatedAt: Date.now() }))
  if (updates.length) await cacheDocs(COLLECTIONS.itemAddons, updates)
}
