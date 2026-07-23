/**
 * Suppliers service — SQLite primary database.
 */
import type { CashDrawerTransaction, Supplier, SupplierTransaction, SupplierTransactionType } from '@shared/types'
import { COLLECTIONS } from '@shared/constants/collections'
import { cacheDocs, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { dbBatch, dbDelete, type DbBatchOp } from '@renderer/lib/db/sqlite-db'
import { generateId } from '@renderer/lib/utils/id'
import { actorAuditName, describePatch, type AuditActor } from '@renderer/features/audit/audit-service'
import { ensureCashDrawerCanPay } from '@renderer/features/cash/cash-service'

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
  paidAmount?: number
  paymentMethod?: 'cash' | 'card' | 'bank' | 'other'
  paymentSource?: 'cash_drawer' | 'external'
  noteAr?: string
  shiftId?: string
  createdBy: string
  actor?: AuditActor
}): Promise<SupplierTransaction> {
  const suppliers = await getCachedDocs<Supplier>(COLLECTIONS.suppliers)
  const supplierName = suppliers.find((supplier) => supplier.id === params.supplierId)?.nameAr ?? params.supplierId
  const currentBalance = await getSupplierBalance(params.supplierId)
  const isPayment = params.type === 'payment' || params.type === 'debt_decrease' || params.type === 'settlement'
  const paidAmount = Math.max(0, Math.round((params.paidAmount ?? (isPayment ? params.amount : 0)) * 100) / 100)
  if (!isPayment && paidAmount > params.amount + 0.001) {
    throw new Error('لا يمكن دفع مبلغ أكبر من قيمة التوريد')
  }
  if (isPayment && params.amount > currentBalance + 0.001) {
    throw new Error(`لا يمكن دفع مبلغ أكبر من مديونية المورد الحالية (${currentBalance.toFixed(2)})`)
  }
  if (paidAmount > 0 && (params.paymentSource ?? 'cash_drawer') === 'cash_drawer' && (params.paymentMethod ?? 'cash') === 'cash') {
    await ensureCashDrawerCanPay(params.shiftId, paidAmount)
  }
  const remainingAmount = isPayment
    ? Math.max(0, Math.round((currentBalance - params.amount) * 100) / 100)
    : Math.max(0, Math.round((currentBalance + params.amount - paidAmount) * 100) / 100)
  const actorName = params.actor ? actorAuditName(params.actor) : params.createdBy
  const tx: SupplierTransaction = {
    id: generateId(),
    supplierId: params.supplierId,
    type: params.type,
    amount: params.amount,
    paidAmount: paidAmount > 0 ? paidAmount : undefined,
    remainingAmount,
    paymentMethod: paidAmount > 0 ? (params.paymentMethod ?? 'cash') : undefined,
    paymentSource: paidAmount > 0 ? (params.paymentSource ?? 'cash_drawer') : undefined,
    noteAr: params.noteAr,
    shiftId: params.shiftId,
    createdBy: params.createdBy,
    createdByName: actorName,
    paidBy: isPayment ? params.createdBy : undefined,
    paidByName: isPayment ? actorName : undefined,
    createdAt: Date.now()
  }
  const ops: DbBatchOp[] = [{ collection: COLLECTIONS.supplierTransactions, id: tx.id, data: tx, op: 'set' }]
  if (paidAmount > 0 && tx.paymentSource === 'cash_drawer' && tx.paymentMethod === 'cash') {
    const drawerTx: CashDrawerTransaction = {
      id: generateId(),
      type: 'supplier_payment',
      amount: -Math.abs(paidAmount),
      shiftId: params.shiftId,
      supplierId: params.supplierId,
      noteAr: params.noteAr || 'دفع مورد',
      createdBy: params.createdBy,
      createdAt: tx.createdAt
    }
    ops.push({ collection: COLLECTIONS.cashDrawerTransactions, id: drawerTx.id, data: drawerTx, op: 'set' })
  }
  await dbBatch(ops)
  audit(params.actor, {
    action: 'supplier_transaction_recorded',
    actorId: params.actor?.id ?? params.createdBy,
    actorName: params.actor ? actorAuditName(params.actor) : params.createdBy,
    targetId: tx.id,
    targetType: 'supplier',
    detailAr: `حركة مورد — ${supplierName} — ${SUPPLIER_TX_LABELS[params.type]} — المبلغ ${params.amount}${params.noteAr ? ` — ملاحظة: ${params.noteAr}` : ''}`
  })
  if (paidAmount > 0) {
    audit(params.actor, {
      action: 'supplier_transaction_recorded',
      actorId: params.actor?.id ?? params.createdBy,
      actorName,
      targetId: tx.id,
      targetType: 'supplier',
      detailAr: `تم دفع ${paidAmount.toFixed(2)} للمورد ${supplierName} نقدًا من الدرج — إجمالي الحركة: ${params.amount.toFixed(2)} — المتبقي: ${remainingAmount.toFixed(2)} — المستخدم: ${actorName}`
    })
  }
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
    if (tx.type === 'purchase_credit') {
      return sum + Math.max(0, tx.amount - (tx.paidAmount ?? 0))
    }
    return sum + tx.amount
  }, 0)
}
