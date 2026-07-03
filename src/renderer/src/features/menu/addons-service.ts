/**
 * Master add-ons — predefined list (إضافة جبنة / صوص إضافي / بطاطس / كولا …)
 * Users pick from this list when creating/editing a product instead of typing free text.
 */
import type { ItemAddon } from '@shared/types'
import { COLLECTIONS } from '@shared/constants/collections'
import { cacheDocs, getCachedDoc, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { dbDelete } from '@renderer/lib/db/sqlite-db'
import { generateId } from '@renderer/lib/utils/id'
import { actorAuditName, describePatch, type AuditActor } from '@renderer/features/audit/audit-service'

function audit(actor: AuditActor | undefined, params: Parameters<typeof import('@renderer/features/audit/audit-service').logAudit>[0]): void {
  if (!actor) return
  void import('@renderer/features/audit/audit-service').then(({ logAudit }) => logAudit(params))
}

export async function listAddons(): Promise<ItemAddon[]> {
  const addons = await getCachedDocs<ItemAddon>(COLLECTIONS.itemAddons)
  return addons.sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function createAddon(
  nameAr: string,
  defaultPrice: number,
  sortOrder: number,
  linkedIngredientId?: string,
  actor?: AuditActor
): Promise<ItemAddon> {
  const now = Date.now()
  const addon: ItemAddon = {
    id: generateId(),
    nameAr,
    defaultPrice,
    linkedIngredientId,
    sortOrder,
    active: true,
    createdAt: now,
    updatedAt: now
  }
  await cacheDocs(COLLECTIONS.itemAddons, [addon])
  audit(actor, {
    action: 'item_addon_created',
    actorId: actor?.id ?? 'system',
    actorName: actor ? actorAuditName(actor) : 'system',
    targetId: addon.id,
    targetType: 'item_addon',
    detailAr: `إضافة إضافة: ${addon.nameAr} — السعر الافتراضي ${addon.defaultPrice}`
  })
  return addon
}

export async function updateAddon(
  id: string,
  patch: Partial<Pick<ItemAddon, 'nameAr' | 'defaultPrice' | 'linkedIngredientId' | 'sortOrder' | 'active'>>,
  actor?: AuditActor
): Promise<void> {
  const cached = await getCachedDoc<ItemAddon>(COLLECTIONS.itemAddons, id)
  if (!cached) return
  await cacheDocs(COLLECTIONS.itemAddons, [{ ...cached, ...patch, updatedAt: Date.now() }])
  audit(actor, {
    action: 'item_addon_updated',
    actorId: actor?.id ?? 'system',
    actorName: actor ? actorAuditName(actor) : 'system',
    targetId: id,
    targetType: 'item_addon',
    detailAr: `تعديل إضافة "${cached.nameAr}" — ${describePatch(patch)}`
  })
}

export async function deleteAddon(id: string, actor?: AuditActor): Promise<void> {
  const cached = await getCachedDoc<ItemAddon>(COLLECTIONS.itemAddons, id)
  await dbDelete(COLLECTIONS.itemAddons, id)
  audit(actor, {
    action: 'item_addon_deleted',
    actorId: actor?.id ?? 'system',
    actorName: actor ? actorAuditName(actor) : 'system',
    targetId: id,
    targetType: 'item_addon',
    detailAr: `حذف إضافة: ${cached?.nameAr ?? id}`
  })
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
