/**
 * Suppliers service — SQLite primary database.
 */
import type { Supplier, SupplierTransaction, SupplierTransactionType } from '@shared/types'
import { COLLECTIONS } from '@shared/constants/collections'
import { cacheDocs, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { dbDelete } from '@renderer/lib/db/sqlite-db'
import { generateId } from '@renderer/lib/utils/id'
import { actorAuditName, describePatch, type AuditActor } from '@renderer/features/audit/audit-service'

function audit(actor: AuditActor | undefined, params: Parameters<typeof import('@renderer/features/audit/audit-service').logAudit>[0]): void {
  if (!actor) return
  void import('@renderer/features/audit/audit-service').then(({ logAudit }) => logAudit(params))
}

const SUPPLIER_TX_LABELS: Record<SupplierTransactionType, string> = {
  purchase_credit: 'توريد على الحساب',
  payment: 'دفعة للمورد',
  debt_increase: 'زيادة مديونية',
  debt_decrease: 'تقليل مديونية',
  settlement: 'تصفية حساب'
}

export async function listSuppliers(activeOnly = false): Promise<Supplier[]> {
  let suppliers = await getCachedDocs<Supplier>(COLLECTIONS.suppliers)
  suppliers = suppliers.sort((a, b) => a.nameAr.localeCompare(b.nameAr, 'ar'))
  return activeOnly ? suppliers.filter((s) => s.active) : suppliers
}

export async function createSupplier(data: {
  nameAr: string
  phone?: string
  noteAr?: string
}, actor?: AuditActor): Promise<Supplier> {
  const now = Date.now()
  const supplier: Supplier = {
    id: generateId(),
    nameAr: data.nameAr,
    phone: data.phone,
    noteAr: data.noteAr,
    active: true,
    createdAt: now,
    updatedAt: now
  }
  await cacheDocs(COLLECTIONS.suppliers, [supplier])
  audit(actor, {
    action: 'supplier_created',
    actorId: actor?.id ?? 'system',
    actorName: actor ? actorAuditName(actor) : 'system',
    targetId: supplier.id,
    targetType: 'supplier',
    detailAr: `إضافة مورد: ${supplier.nameAr}${supplier.phone ? ` — هاتف ${supplier.phone}` : ''}${supplier.noteAr ? ` — ملاحظة: ${supplier.noteAr}` : ''}`
  })
  return supplier
}

export async function updateSupplier(
  id: string,
  patch: Partial<Pick<Supplier, 'nameAr' | 'phone' | 'noteAr' | 'active'>>,
  actor?: AuditActor
): Promise<void> {
  const suppliers = await getCachedDocs<Supplier>(COLLECTIONS.suppliers)
  const cached = suppliers.find((s) => s.id === id)
  if (!cached) return
  await cacheDocs(COLLECTIONS.suppliers, [{ ...cached, ...patch, updatedAt: Date.now() }])
  audit(actor, {
    action: 'supplier_updated',
    actorId: actor?.id ?? 'system',
    actorName: actor ? actorAuditName(actor) : 'system',
    targetId: id,
    targetType: 'supplier',
    detailAr: `تعديل مورد "${cached.nameAr}" — ${describePatch(patch)}`
  })
}

export async function deleteSupplier(id: string, actor?: AuditActor): Promise<void> {
  const suppliers = await getCachedDocs<Supplier>(COLLECTIONS.suppliers)
  const cached = suppliers.find((s) => s.id === id)
  const transactions = await listSupplierTransactions(id)
  await Promise.all([
    dbDelete(COLLECTIONS.suppliers, id),
    ...transactions.map((tx) => dbDelete(COLLECTIONS.supplierTransactions, tx.id))
  ])
  audit(actor, {
    action: 'supplier_deleted',
    actorId: actor?.id ?? 'system',
    actorName: actor ? actorAuditName(actor) : 'system',
    targetId: id,
    targetType: 'supplier',
    detailAr: `حذف مورد: ${cached?.nameAr ?? id} — تم حذف ${transactions.length} حركة مرتبطة`
  })
}

export async function recordSupplierTransaction(params: {
  supplierId: string
  type: SupplierTransactionType
  amount: number
  noteAr?: string
  shiftId?: string
  createdBy: string
  actor?: AuditActor
}): Promise<SupplierTransaction> {
  const tx: SupplierTransaction = {
    id: generateId(),
    supplierId: params.supplierId,
    type: params.type,
    amount: params.amount,
    noteAr: params.noteAr,
    shiftId: params.shiftId,
    createdBy: params.createdBy,
    createdAt: Date.now()
  }
  await cacheDocs(COLLECTIONS.supplierTransactions, [tx])
  const suppliers = await getCachedDocs<Supplier>(COLLECTIONS.suppliers)
  const supplierName = suppliers.find((supplier) => supplier.id === params.supplierId)?.nameAr ?? params.supplierId
  audit(params.actor, {
    action: 'supplier_transaction_recorded',
    actorId: params.actor?.id ?? params.createdBy,
    actorName: params.actor ? actorAuditName(params.actor) : params.createdBy,
    targetId: tx.id,
    targetType: 'supplier',
    detailAr: `حركة مورد — ${supplierName} — ${SUPPLIER_TX_LABELS[params.type]} — المبلغ ${params.amount}${params.noteAr ? ` — ملاحظة: ${params.noteAr}` : ''}`
  })
  return tx
}

export async function listSupplierTransactions(
  supplierId?: string
): Promise<SupplierTransaction[]> {
  let txs = await getCachedDocs<SupplierTransaction>(COLLECTIONS.supplierTransactions)
  if (supplierId) txs = txs.filter((tx) => tx.supplierId === supplierId)
  return txs.sort((a, b) => b.createdAt - a.createdAt)
}

export async function getSupplierBalance(supplierId: string): Promise<number> {
  const txs = await listSupplierTransactions(supplierId)
  return txs.reduce((sum, tx) => {
    if (tx.type === 'payment' || tx.type === 'debt_decrease' || tx.type === 'settlement') {
      return sum - tx.amount
    }
    return sum + tx.amount
  }, 0)
}
