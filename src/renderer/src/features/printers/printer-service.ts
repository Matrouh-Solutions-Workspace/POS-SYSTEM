import { COLLECTIONS } from '@shared/constants/collections'
import type { KitchenPrinter, KitchenPrinterVisibility, MenuItem, SystemPrinter } from '@shared/types'
import { cacheDocs, getCachedDoc, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { dbDelete } from '@renderer/lib/db/sqlite-db'
import { generateId } from '@renderer/lib/utils/id'

export const DEFAULT_KITCHEN_VISIBILITY: KitchenPrinterVisibility = {
  showOrderType: true,
  showTable: true,
  showCashier: true,
  showCustomer: true,
  showOrderNote: true,
  showItemNotes: true
}

export async function listSystemPrinters(): Promise<SystemPrinter[]> {
  return window.electronAPI?.listPrinters?.() ?? []
}

export async function listKitchenPrinters(activeOnly = false): Promise<KitchenPrinter[]> {
  let printers = (await getCachedDocs<KitchenPrinter>(COLLECTIONS.kitchenPrinters)).map((printer) => ({
    ...printer,
    copies: printer.copies || 1,
    visibility: { ...DEFAULT_KITCHEN_VISIBILITY, ...(printer.visibility ?? {}) }
  }))
  if (activeOnly) printers = printers.filter((printer) => printer.active)
  return printers.sort((a, b) => a.name.localeCompare(b.name, 'ar'))
}

export async function createKitchenPrinter(params: {
  name: string
  deviceName: string
  description?: string
  copies?: number
  visibility?: KitchenPrinterVisibility
}): Promise<KitchenPrinter> {
  const now = Date.now()
  const printer: KitchenPrinter = {
    id: generateId(),
    name: params.name.trim(),
    deviceName: params.deviceName,
    description: params.description?.trim() || undefined,
    copies: Math.max(1, Math.min(5, params.copies ?? 1)),
    visibility: params.visibility ?? DEFAULT_KITCHEN_VISIBILITY,
    active: true,
    createdAt: now,
    updatedAt: now
  }
  await cacheDocs(COLLECTIONS.kitchenPrinters, [printer])
  return printer
}

export async function updateKitchenPrinter(
  id: string,
  patch: Partial<Pick<KitchenPrinter, 'name' | 'deviceName' | 'description' | 'copies' | 'active' | 'visibility'>>
): Promise<void> {
  const cached = await getCachedDoc<KitchenPrinter>(COLLECTIONS.kitchenPrinters, id)
  if (!cached) return
  await cacheDocs(COLLECTIONS.kitchenPrinters, [{
    ...cached,
    ...patch,
    name: patch.name?.trim() ?? cached.name,
    description: patch.description?.trim() || undefined,
    copies: patch.copies != null ? Math.max(1, Math.min(5, patch.copies)) : cached.copies,
    visibility: patch.visibility ? { ...cached.visibility, ...patch.visibility } : cached.visibility,
    updatedAt: Date.now()
  }])
}

export async function deleteKitchenPrinter(id: string): Promise<void> {
  const items = await getCachedDocs<MenuItem>(COLLECTIONS.menuItems)
  const updates = items
    .filter((item) => item.kitchenPrinterIds?.includes(id))
    .map((item) => ({
      ...item,
      kitchenPrinterIds: (item.kitchenPrinterIds ?? []).filter((printerId) => printerId !== id),
      updatedAt: Date.now()
    }))
  if (updates.length) await cacheDocs(COLLECTIONS.menuItems, updates)
  await dbDelete(COLLECTIONS.kitchenPrinters, id)
}
