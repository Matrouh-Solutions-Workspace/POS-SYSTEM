import type { InventoryBatch, InventoryTransaction } from '@shared/types'
import { COLLECTIONS } from '@shared/constants/collections'
import { getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { generateId } from '@renderer/lib/utils/id'

export interface FifoPlan {
  transactions: InventoryTransaction[]
  batches: InventoryBatch[]
}

export async function planFifoConsumption(params: {
  lines: Array<{
    ingredientId: string
    quantity: number
    unit: string
    orderItemId?: string
    menuItemId?: string
  }>
  referenceId: string
  createdBy: string
  createdAt: number
  shiftId?: string
  noteAr: string
  batches?: InventoryBatch[]
}): Promise<FifoPlan> {
  const source = params.batches ?? await getCachedDocs<InventoryBatch>(COLLECTIONS.inventoryBatches)
  const mutable = source.map((batch) => ({ ...batch }))
  const changed = new Map<string, InventoryBatch>()
  const transactions: InventoryTransaction[] = []

  for (const line of params.lines) {
    let required = Math.abs(line.quantity)
    const available = mutable
      .filter((batch) => batch.ingredientId === line.ingredientId && batch.remainingQuantity > 0)
      .sort((a, b) => a.receivedAt - b.receivedAt)

    for (const batch of available) {
      if (required <= 0.000001) break
      const used = Math.min(required, batch.remainingQuantity)
      batch.remainingQuantity = Math.max(0, batch.remainingQuantity - used)
      changed.set(batch.id, batch)
      transactions.push({
        id: generateId(),
        ingredientId: line.ingredientId,
        orderItemId: line.orderItemId,
        menuItemId: line.menuItemId,
        type: 'sale',
        quantity: -used,
        unit: line.unit,
        referenceType: 'order',
        referenceId: params.referenceId,
        shiftId: params.shiftId,
        batchId: batch.id,
        unitCost: batch.unitCost,
        totalCost: used * batch.unitCost,
        noteAr: params.noteAr,
        createdBy: params.createdBy,
        createdAt: params.createdAt
      })
      required -= used
    }

    // Older databases may have stock movements but no batch history. Keep sales
    // operational and mark the unmatched cost as zero until new costed stock arrives.
    if (required > 0.000001) {
      transactions.push({
        id: generateId(),
        ingredientId: line.ingredientId,
        orderItemId: line.orderItemId,
        menuItemId: line.menuItemId,
        type: 'sale',
        quantity: -required,
        unit: line.unit,
        referenceType: 'order',
        referenceId: params.referenceId,
        shiftId: params.shiftId,
        unitCost: 0,
        totalCost: 0,
        noteAr: `${params.noteAr} (رصيد قديم بدون تكلفة دفعة)`,
        createdBy: params.createdBy,
        createdAt: params.createdAt
      })
    }
  }

  return { transactions, batches: Array.from(changed.values()) }
}

export async function planFifoReversal(
  sourceTransactions: InventoryTransaction[],
  params: {
    referenceId: string
    createdBy: string
    createdAt: number
    noteAr: string
    ratio?: number
    batches?: InventoryBatch[]
  }
): Promise<FifoPlan> {
  const source = params.batches ?? await getCachedDocs<InventoryBatch>(COLLECTIONS.inventoryBatches)
  const mutable = source.map((batch) => ({ ...batch }))
  const byId = new Map(mutable.map((batch) => [batch.id, batch]))
  const changed = new Map<string, InventoryBatch>()
  const ratio = Math.max(0, Math.min(1, params.ratio ?? 1))
  const transactions = sourceTransactions.map((tx) => {
    const quantity = Math.abs(tx.quantity) * ratio
    const batch = tx.batchId ? byId.get(tx.batchId) : undefined
    if (batch) {
      batch.remainingQuantity = Math.min(batch.quantity, batch.remainingQuantity + quantity)
      changed.set(batch.id, batch)
    }
    return {
      id: generateId(),
      ingredientId: tx.ingredientId,
      orderItemId: tx.orderItemId,
      menuItemId: tx.menuItemId,
      type: 'sale_reversal' as const,
      quantity,
      unit: tx.unit,
      referenceType: 'order' as const,
      referenceId: params.referenceId,
      shiftId: tx.shiftId,
      batchId: tx.batchId,
      unitCost: tx.unitCost,
      totalCost: (tx.totalCost ?? Math.abs(tx.quantity) * (tx.unitCost ?? 0)) * ratio,
      noteAr: params.noteAr,
      createdBy: params.createdBy,
      createdAt: params.createdAt
    }
  })
  return { transactions, batches: Array.from(changed.values()) }
}
