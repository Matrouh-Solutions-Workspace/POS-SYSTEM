import type {
  Ingredient,
  InventoryBatch,
  InventoryTransaction,
  SupplierReturn,
  SupplierReturnItem,
  SupplierTransaction
} from '@shared/types'
import { COLLECTIONS } from '@shared/constants/collections'
import { getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { dbBatch } from '@renderer/lib/db/sqlite-db'
import { generateId } from '@renderer/lib/utils/id'
import { actorAuditName, type AuditActor } from '@renderer/features/audit/audit-service'

export interface SupplierReturnReportRow extends SupplierReturn {
  supplierName: string
  userName: string
  items: Array<SupplierReturnItem & { ingredientName: string }>
}

export async function createSupplierReturn(params: {
  supplierId: string
  ingredientId: string
  quantity: number
  reason: string
  actor: AuditActor
}): Promise<SupplierReturn> {
  const quantity = Math.abs(params.quantity)
  if (!params.supplierId) throw new Error('اختر المورد')
  if (!params.ingredientId) throw new Error('اختر الصنف المرتجع')
  if (!quantity) throw new Error('كمية المرتجع يجب أن تكون أكبر من صفر')
  if (!params.reason.trim()) throw new Error('سبب المرتجع مطلوب')

  const batches = (await getCachedDocs<InventoryBatch>(COLLECTIONS.inventoryBatches))
    .filter((batch) =>
      batch.supplierId === params.supplierId &&
      batch.ingredientId === params.ingredientId &&
      batch.remainingQuantity > 0
    )
    .sort((a, b) => a.receivedAt - b.receivedAt)
    .map((batch) => ({ ...batch }))
  const available = batches.reduce((sum, batch) => sum + batch.remainingQuantity, 0)
  if (quantity > available + 0.000001) {
    throw new Error(`الكمية المتاحة من دفعات هذا المورد هي ${available.toFixed(3)} فقط`)
  }

  const now = Date.now()
  const returnRecord: SupplierReturn = {
    id: generateId(),
    supplierId: params.supplierId,
    userId: params.actor.id,
    totalAmount: 0,
    reason: params.reason.trim(),
    createdAt: now
  }
  const items: SupplierReturnItem[] = []
  const movements: InventoryTransaction[] = []
  const changedBatches: InventoryBatch[] = []
  let remaining = quantity

  for (const batch of batches) {
    if (remaining <= 0.000001) break
    const used = Math.min(remaining, batch.remainingQuantity)
    batch.remainingQuantity -= used
    changedBatches.push(batch)
    const totalCost = used * batch.unitCost
    items.push({
      id: generateId(),
      returnId: returnRecord.id,
      ingredientId: params.ingredientId,
      quantity: used,
      unit: batch.unit,
      unitCost: batch.unitCost,
      totalCost,
      batchId: batch.id
    })
    movements.push({
      id: generateId(),
      ingredientId: params.ingredientId,
      type: 'supplier_return',
      quantity: -used,
      unit: batch.unit,
      referenceType: 'supplier',
      referenceId: returnRecord.id,
      supplierId: params.supplierId,
      batchId: batch.id,
      unitCost: batch.unitCost,
      totalCost,
      noteAr: params.reason.trim(),
      createdBy: params.actor.id,
      createdAt: now
    })
    returnRecord.totalAmount += totalCost
    remaining -= used
  }
  returnRecord.totalAmount = Math.round(returnRecord.totalAmount * 100) / 100
  const supplierCredit: SupplierTransaction | null = returnRecord.totalAmount > 0
    ? {
        id: generateId(),
        supplierId: params.supplierId,
        type: 'debt_decrease',
        amount: returnRecord.totalAmount,
        noteAr: `مرتجع مورد: ${params.reason.trim()}`,
        createdBy: params.actor.id,
        createdAt: now
      }
    : null

  await dbBatch([
    { collection: COLLECTIONS.supplierReturns, id: returnRecord.id, data: returnRecord, op: 'set' },
    ...items.map((item) => ({ collection: COLLECTIONS.supplierReturnItems, id: item.id, data: item, op: 'set' as const })),
    ...movements.map((movement) => ({ collection: COLLECTIONS.inventoryTransactions, id: movement.id, data: movement, op: 'set' as const })),
    ...changedBatches.map((batch) => ({ collection: COLLECTIONS.inventoryBatches, id: batch.id, data: batch, op: 'set' as const })),
    ...(supplierCredit ? [{ collection: COLLECTIONS.supplierTransactions, id: supplierCredit.id, data: supplierCredit, op: 'set' as const }] : [])
  ])

  const ingredients = await getCachedDocs<Ingredient>(COLLECTIONS.ingredients)
  const ingredientName = ingredients.find((ingredient) => ingredient.id === params.ingredientId)?.nameAr ?? params.ingredientId
  void import('@renderer/features/audit/audit-service').then(({ logAudit }) => logAudit({
    action: 'inventory_adjustment',
    actorId: params.actor.id,
    actorName: actorAuditName(params.actor),
    targetId: returnRecord.id,
    targetType: 'inventory',
    detailAr: `مرتجع مورد — ${ingredientName} — ${quantity} — قيمة ${returnRecord.totalAmount.toFixed(2)} — ${returnRecord.reason}`
  }))
  return returnRecord
}

export async function listSupplierReturnReport(filters?: {
  from?: number
  to?: number
  supplierId?: string
  ingredientId?: string
}): Promise<SupplierReturnReportRow[]> {
  const [returns, items, ingredients, suppliers, users] = await Promise.all([
    getCachedDocs<SupplierReturn>(COLLECTIONS.supplierReturns),
    getCachedDocs<SupplierReturnItem>(COLLECTIONS.supplierReturnItems),
    getCachedDocs<Ingredient>(COLLECTIONS.ingredients),
    getCachedDocs<{ id: string; nameAr: string }>(COLLECTIONS.suppliers),
    getCachedDocs<{ id: string; username: string }>(COLLECTIONS.users)
  ])
  return returns
    .filter((record) =>
      (!filters?.from || record.createdAt >= filters.from) &&
      (!filters?.to || record.createdAt <= filters.to) &&
      (!filters?.supplierId || record.supplierId === filters.supplierId)
    )
    .map((record) => ({
      ...record,
      supplierName: suppliers.find((supplier) => supplier.id === record.supplierId)?.nameAr ?? record.supplierId,
      userName: users.find((user) => user.id === record.userId)?.username ?? record.userId,
      items: items
        .filter((item) => item.returnId === record.id && (!filters?.ingredientId || item.ingredientId === filters.ingredientId))
        .map((item) => ({
          ...item,
          ingredientName: ingredients.find((ingredient) => ingredient.id === item.ingredientId)?.nameAr ?? item.ingredientId
        }))
    }))
    .filter((record) => record.items.length > 0)
    .sort((a, b) => b.createdAt - a.createdAt)
}
