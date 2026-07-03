/**
 * Inventory service — SQLite primary database.
 * REQ-11: getIngredientStocks uses materialized ingredient_stock table (O(1) per ingredient)
 * instead of scanning all inventory_transactions (O(n)).
 *
 * All inventory writes go through dbBatch() so the ingredient_stock
 * materialized table is always updated atomically in the same transaction.
 */
import type {
  Ingredient,
  InventoryTransaction,
  InventoryTransactionType,
  InventoryBatch,
  IngredientStock,
  MenuItem,
  Recipe,
  Supplier
} from '@shared/types'
import { COLLECTIONS } from '@shared/constants/collections'
import { cacheDocs, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { dbBatch, dbDelete } from '@renderer/lib/db/sqlite-db'
import { generateId } from '@renderer/lib/utils/id'
import { actorAuditName, describePatch, type AuditActor } from '@renderer/features/audit/audit-service'

function audit(actor: AuditActor | undefined, params: Parameters<typeof import('@renderer/features/audit/audit-service').logAudit>[0]): void {
  if (!actor) return
  void import('@renderer/features/audit/audit-service').then(({ logAudit }) => logAudit(params))
}

export async function listIngredients(): Promise<Ingredient[]> {
  const ingredients = await getCachedDocs<Ingredient>(COLLECTIONS.ingredients)
  return ingredients.sort((a, b) => a.nameAr.localeCompare(b.nameAr, 'ar'))
}

export async function createIngredient(
  data: Omit<Ingredient, 'id' | 'createdAt' | 'updatedAt'>,
  actor?: AuditActor
): Promise<Ingredient> {
  const now = Date.now()
  const ingredient: Ingredient = { ...data, id: generateId(), createdAt: now, updatedAt: now }
  await cacheDocs(COLLECTIONS.ingredients, [ingredient])
  audit(actor, {
    action: 'ingredient_created',
    actorId: actor?.id ?? 'system',
    actorName: actor ? actorAuditName(actor) : 'system',
    targetId: ingredient.id,
    targetType: 'ingredient',
    detailAr: `إضافة مكوّن: ${ingredient.nameAr} — الوحدة ${ingredient.unit}`
  })
  return ingredient
}

export async function updateIngredient(
  id: string,
  patch: Partial<Pick<Ingredient, 'nameAr' | 'unit' | 'lowStockThreshold' | 'active'>>,
  actor?: AuditActor
): Promise<void> {
  const ingredients = await getCachedDocs<Ingredient>(COLLECTIONS.ingredients)
  const cached = ingredients.find((i) => i.id === id)
  if (!cached) return
  await cacheDocs(COLLECTIONS.ingredients, [{ ...cached, ...patch, updatedAt: Date.now() }])
  audit(actor, {
    action: 'ingredient_updated',
    actorId: actor?.id ?? 'system',
    actorName: actor ? actorAuditName(actor) : 'system',
    targetId: id,
    targetType: 'ingredient',
    detailAr: `تعديل مكوّن "${cached.nameAr}" — ${describePatch(patch)}`
  })
}

export async function deleteIngredient(id: string, actor?: AuditActor): Promise<void> {
  const ingredients = await getCachedDocs<Ingredient>(COLLECTIONS.ingredients)
  const cached = ingredients.find((i) => i.id === id)
  const recipes = await getCachedDocs<{ lines?: Array<{ ingredientId: string }> }>(
    COLLECTIONS.recipes
  )
  const used = recipes.some((r) => (r.lines ?? []).some((l) => l.ingredientId === id))
  if (used) {
    throw new Error('لا يمكن الحذف — المكوّن مستخدم في وصفة. احذف الصنف من القائمة أولاً.')
  }
  const linkedMenuItems = await getCachedDocs<MenuItem>(COLLECTIONS.menuItems)
  const linked = linkedMenuItems.some((item) => item.linkedIngredientId === id)
  const linkedAddons = await getCachedDocs<{ linkedIngredientId?: string }>(COLLECTIONS.itemAddons)
  const linkedAddon = linkedAddons.some((addon) => addon.linkedIngredientId === id)
  if (linked || linkedAddon) {
    throw new Error('لا يمكن الحذف — المكوّن مرتبط بصنف أو إضافة للبيع. أزل الربط أولاً.')
  }
  await dbDelete(COLLECTIONS.ingredients, id)
  audit(actor, {
    action: 'ingredient_deleted',
    actorId: actor?.id ?? 'system',
    actorName: actor ? actorAuditName(actor) : 'system',
    targetId: id,
    targetType: 'ingredient',
    detailAr: `حذف مكوّن: ${cached?.nameAr ?? id}`
  })
}

export async function recordInventoryTransaction(params: {
  ingredientId: string
  type: InventoryTransactionType
  quantity: number
  unit: string
  referenceType?: InventoryTransaction['referenceType']
  referenceId?: string
  noteAr?: string
  createdBy: string
  shiftId?: string
  supplierId?: string
  batchId?: string
  unitCost?: number
  totalCost?: number
  actor?: AuditActor
}): Promise<InventoryTransaction> {
  const tx: InventoryTransaction = {
    id: generateId(),
    ingredientId: params.ingredientId,
    type: params.type,
    quantity: params.quantity,
    unit: params.unit,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    shiftId: params.shiftId,
    supplierId: params.supplierId,
    batchId: params.batchId,
    unitCost: params.unitCost,
    totalCost: params.totalCost,
    noteAr: params.noteAr,
    createdBy: params.createdBy,
    createdAt: Date.now()
  }
  // Use dbBatch so the ingredient_stock materialized table is updated atomically (REQ-11)
  await dbBatch([{ collection: COLLECTIONS.inventoryTransactions, id: tx.id, data: tx, op: 'set' }])
  const action = tx.type === 'purchase'
    ? 'inventory_purchase'
    : tx.type === 'waste'
      ? 'inventory_waste'
      : tx.type === 'adjustment'
        ? 'inventory_adjustment'
        : null
  if (action) {
    const [ingredients, suppliers] = await Promise.all([
      getCachedDocs<Ingredient>(COLLECTIONS.ingredients),
      getCachedDocs<Supplier>(COLLECTIONS.suppliers)
    ])
    const ingredientName = ingredients.find((ingredient) => ingredient.id === tx.ingredientId)?.nameAr ?? tx.ingredientId
    const supplierName = tx.supplierId ? (suppliers.find((supplier) => supplier.id === tx.supplierId)?.nameAr ?? tx.supplierId) : ''
    audit(params.actor, {
      action,
      actorId: params.actor?.id ?? params.createdBy,
      actorName: params.actor ? actorAuditName(params.actor) : params.createdBy,
      targetId: tx.id,
      targetType: 'inventory',
      detailAr: `${tx.type === 'purchase' ? 'تسجيل شراء' : tx.type === 'waste' ? 'تسجيل هدر' : 'تسوية مخزون'} — ${ingredientName} — كمية ${tx.quantity} ${tx.unit}${supplierName ? ` — مورد: ${supplierName}` : ''}${tx.noteAr ? ` — ملاحظة: ${tx.noteAr}` : ''}`
    })
  }
  return tx
}

export async function listInventoryTransactions(
  ingredientId?: string
): Promise<InventoryTransaction[]> {
  let txs = await getCachedDocs<InventoryTransaction>(COLLECTIONS.inventoryTransactions)
  if (ingredientId) txs = txs.filter((tx) => tx.ingredientId === ingredientId)
  return txs.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * REQ-11: Fast stock lookup using the materialized ingredient_stock table.
 *
 * When the electronAPI exposes getIngredientStocks (via the IPC handler added in local-store),
 * we use it directly — O(ingredients) instead of O(transactions).
 *
 * Falls back to the O(n) transaction scan if:
 * - The fast path is unavailable (testing / no IPC)
 * - The materialized table is completely empty (e.g. existing database before the migration)
 */
export async function getIngredientStocks(): Promise<IngredientStock[]> {
  const ingredients = await listIngredients()
  const active = ingredients.filter((i) => i.active)

  // Fast path — materialized table (REQ-11)
  if (window.electronAPI?.getIngredientStocks) {
    try {
      const rows = await window.electronAPI.getIngredientStocks()
      // Only trust the materialized table if it has at least one row.
      // An empty table means the DB predates this feature — fall through to rebuild from transactions.
      if (rows.length > 0) {
        const stockMap = new Map<string, number>(rows.map((r) => [r.ingredient_id, r.quantity]))
        return active.map((i) => ({
          ingredientId: i.id,
          nameAr: i.nameAr,
          unit: i.unit,
          quantity: stockMap.get(i.id) ?? 0,
          lowStockThreshold: i.lowStockThreshold
        }))
      }
    } catch {
      // fall through to slow path
    }
  }

  // Slow path — full transaction scan (fallback / bootstrap)
  const txs = await listInventoryTransactions()
  const stockMap = new Map<string, number>()
  for (const tx of txs) {
    stockMap.set(tx.ingredientId, (stockMap.get(tx.ingredientId) ?? 0) + tx.quantity)
  }
  return active.map((i) => ({
    ingredientId: i.id,
    nameAr: i.nameAr,
    unit: i.unit,
    quantity: stockMap.get(i.id) ?? 0,
    lowStockThreshold: i.lowStockThreshold
  }))
}

export async function recordPurchase(params: {
  ingredientId: string
  quantity: number
  unit: string
  noteAr?: string
  createdBy: string
  shiftId?: string
  supplierId?: string
  totalCost?: number
  actor?: AuditActor
}): Promise<InventoryTransaction> {
  const quantity = Math.abs(params.quantity)
  if (!quantity) throw new Error('الكمية المشتراة يجب أن تكون أكبر من صفر')
  const totalCost = Math.max(0, Number(params.totalCost) || 0)
  const now = Date.now()
  const tx: InventoryTransaction = {
    id: generateId(),
    ingredientId: params.ingredientId,
    type: 'purchase',
    quantity,
    unit: params.unit,
    referenceType: 'purchase',
    shiftId: params.shiftId,
    supplierId: params.supplierId,
    unitCost: totalCost / quantity,
    totalCost,
    noteAr: params.noteAr,
    createdBy: params.createdBy,
    createdAt: now
  }
  const batch: InventoryBatch = {
    id: generateId(),
    ingredientId: params.ingredientId,
    supplierId: params.supplierId,
    purchaseTransactionId: tx.id,
    quantity,
    remainingQuantity: quantity,
    unit: params.unit,
    unitCost: tx.unitCost ?? 0,
    receivedAt: now,
    createdBy: params.createdBy
  }
  tx.batchId = batch.id
  await dbBatch([
    { collection: COLLECTIONS.inventoryTransactions, id: tx.id, data: tx, op: 'set' },
    { collection: COLLECTIONS.inventoryBatches, id: batch.id, data: batch, op: 'set' }
  ])
  const ingredients = await getCachedDocs<Ingredient>(COLLECTIONS.ingredients)
  const ingredientName = ingredients.find((ingredient) => ingredient.id === tx.ingredientId)?.nameAr ?? tx.ingredientId
  audit(params.actor, {
    action: 'inventory_purchase',
    actorId: params.actor?.id ?? params.createdBy,
    actorName: params.actor ? actorAuditName(params.actor) : params.createdBy,
    targetId: tx.id,
    targetType: 'inventory',
    detailAr: `تسجيل شراء — ${ingredientName} — كمية ${quantity} ${params.unit} — تكلفة ${totalCost.toFixed(2)}`
  })
  return tx
}

export async function listInventoryBatches(ingredientId?: string): Promise<InventoryBatch[]> {
  let batches = await getCachedDocs<InventoryBatch>(COLLECTIONS.inventoryBatches)
  if (ingredientId) batches = batches.filter((batch) => batch.ingredientId === ingredientId)
  return batches.sort((a, b) => a.receivedAt - b.receivedAt)
}

export async function recordWaste(params: {
  ingredientId: string
  quantity: number
  unit: string
  noteAr?: string
  createdBy: string
  actor?: AuditActor
}): Promise<InventoryTransaction> {
  return recordInventoryTransaction({
    ...params,
    type: 'waste',
    quantity: -Math.abs(params.quantity),
    referenceType: 'manual',
    noteAr: params.noteAr ?? 'هدر'
  })
}

export async function recordAdjustment(params: {
  ingredientId: string
  quantity: number
  unit: string
  noteAr?: string
  createdBy: string
  actor?: AuditActor
}): Promise<InventoryTransaction> {
  if (params.quantity === 0) throw new Error('كمية التسوية يجب أن تكون غير صفر')
  return recordInventoryTransaction({
    ...params,
    type: 'adjustment',
    quantity: params.quantity,
    referenceType: 'manual',
    noteAr: params.noteAr ?? 'تسوية مخزون'
  })
}

export async function produceManufacturedProduct(params: {
  menuItemId: string
  quantity: number
  createdBy: string
  noteAr?: string
  actor?: AuditActor
}): Promise<InventoryTransaction[]> {
  const producedQuantity = Math.abs(Number(params.quantity) || 0)
  if (producedQuantity <= 0) throw new Error('كمية الإنتاج يجب أن تكون أكبر من صفر')

  const [menuItems, recipes, ingredients, stocks] = await Promise.all([
    getCachedDocs<MenuItem>(COLLECTIONS.menuItems),
    getCachedDocs<Recipe>(COLLECTIONS.recipes),
    getCachedDocs<Ingredient>(COLLECTIONS.ingredients),
    getIngredientStocks()
  ])
  const item = menuItems.find((entry) => entry.id === params.menuItemId)
  if (!item || item.itemType !== 'product' || item.productType !== 'manufactured') {
    throw new Error('اختر منتجًا مصنعًا من القائمة')
  }
  if (!item.linkedIngredientId) {
    throw new Error('المنتج المصنع يجب أن يكون مرتبطًا بمخزون منتج نهائي')
  }
  const producedIngredient = ingredients.find((ingredient) => ingredient.id === item.linkedIngredientId)
  if (!producedIngredient) throw new Error('مخزون المنتج النهائي غير موجود')

  const recipe = recipes.find((entry) => entry.menuItemId === item.id || entry.id === item.recipeId)
  const lines = (recipe?.lines ?? []).filter((line) => line.ingredientId && Number(line.quantity) > 0)
  if (!lines.length) throw new Error('وصفة التصنيع غير مكتملة')

  const stockMap = new Map(stocks.map((stock) => [stock.ingredientId, stock.quantity]))
  const ingredientMap = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]))
  for (const line of lines) {
    if (line.ingredientId === item.linkedIngredientId) {
      throw new Error('لا يمكن أن يحتوي المنتج على نفسه داخل وصفة التصنيع')
    }
    const required = Number(line.quantity) * producedQuantity
    const available = stockMap.get(line.ingredientId) ?? 0
    const ingredientName = ingredientMap.get(line.ingredientId)?.nameAr ?? line.ingredientId
    if (available + 0.0001 < required) {
      throw new Error(`المخزون غير كافٍ من ${ingredientName}. المطلوب ${required} والمتاح ${available}`)
    }
  }

  const now = Date.now()
  const productionId = generateId()
  const txs: InventoryTransaction[] = [
    ...lines.map((line) => {
      const ingredient = ingredientMap.get(line.ingredientId)
      const required = Number(line.quantity) * producedQuantity
      return {
        id: generateId(),
        ingredientId: line.ingredientId,
        ingredientNameAr: ingredient?.nameAr,
        type: 'production' as const,
        quantity: -Math.abs(required),
        unit: line.unit || ingredient?.unit || producedIngredient.unit,
        referenceType: 'production' as const,
        referenceId: productionId,
        menuItemId: item.id,
        noteAr: `تصنيع ${item.nameAr}${params.noteAr ? ` — ${params.noteAr}` : ''}`,
        createdBy: params.createdBy,
        createdAt: now
      }
    }),
    {
      id: generateId(),
      ingredientId: producedIngredient.id,
      ingredientNameAr: producedIngredient.nameAr,
      type: 'production' as const,
      quantity: producedQuantity,
      unit: producedIngredient.unit,
      referenceType: 'production' as const,
      referenceId: productionId,
      menuItemId: item.id,
      noteAr: `إنتاج ${item.nameAr}${params.noteAr ? ` — ${params.noteAr}` : ''}`,
      createdBy: params.createdBy,
      createdAt: now
    }
  ]

  await dbBatch(txs.map((tx) => ({
    collection: COLLECTIONS.inventoryTransactions,
    id: tx.id,
    data: tx,
    op: 'set'
  })))

  audit(params.actor, {
    action: 'inventory_production',
    actorId: params.actor?.id ?? params.createdBy,
    actorName: params.actor ? actorAuditName(params.actor) : params.createdBy,
    targetId: productionId,
    targetType: 'inventory',
    detailAr: `إنتاج ${item.nameAr} — كمية ${producedQuantity} ${producedIngredient.unit} — مكونات ${lines.length}`
  })
  return txs
}
