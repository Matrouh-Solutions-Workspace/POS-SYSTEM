/**
 * Cash drawer service — SQLite primary database.
 */
import type { CashDrawerTransaction, CashDrawerTransactionType, Shift } from '@shared/types'
import { COLLECTIONS } from '@shared/constants/collections'
import { cacheDocs, getCachedDoc, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { generateId } from '@renderer/lib/utils/id'
import { actorAuditName, type AuditActor } from '@renderer/features/audit/audit-service'

export async function recordCashDrawerTransaction(params: {
  type: CashDrawerTransactionType
  amount: number
  shiftId?: string
  orderId?: string
  supplierId?: string
  noteAr?: string
  createdBy: string
  actor?: AuditActor
}): Promise<CashDrawerTransaction> {
  if ((params.type === 'expense' || params.type === 'supplier_payment' || params.type === 'purchase_payment') && params.amount < 0) {
    await ensureCashDrawerCanPay(params.shiftId, Math.abs(params.amount))
  }
  const tx: CashDrawerTransaction = {
    id: generateId(),
    type: params.type,
    amount: params.amount,
    shiftId: params.shiftId,
    orderId: params.orderId,
    supplierId: params.supplierId,
    noteAr: params.noteAr,
    createdBy: params.createdBy,
    createdAt: Date.now()
  }
  await cacheDocs(COLLECTIONS.cashDrawerTransactions, [tx])
  if (params.type === 'expense') {
    void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
      logAudit({
        action: 'cash_out',
        actorId: params.actor?.id ?? params.createdBy,
        actorName: params.actor ? actorAuditName(params.actor) : params.createdBy,
        targetId: tx.id,
        targetType: 'cash',
        detailAr: `مصروف نثري — المستخدم: ${params.actor ? actorAuditName(params.actor) : params.createdBy} — المبلغ: ${Math.abs(params.amount).toFixed(2)} — السبب: ${params.noteAr ?? '-'} — تأثير الدرج: ${params.amount.toFixed(2)} — الوقت: ${new Date(tx.createdAt).toLocaleString('ar-EG')}`
      })
    )
  }
  return tx
}

export async function getCashDrawerBalance(shiftId?: string): Promise<number> {
  if (!shiftId) return Number.POSITIVE_INFINITY
  const [shift, txs] = await Promise.all([
    getCachedDoc<Shift>(COLLECTIONS.shifts, shiftId),
    getCachedDocs<CashDrawerTransaction>(COLLECTIONS.cashDrawerTransactions)
  ])
  const openingCash = shift?.openingCash ?? 0
  const drawerTotal = txs
    .filter((tx) => tx.shiftId === shiftId)
    .reduce((sum, tx) => sum + tx.amount, 0)
  return Math.round((openingCash + drawerTotal) * 100) / 100
}

export async function ensureCashDrawerCanPay(shiftId: string | undefined, amount: number): Promise<void> {
  if (!shiftId || amount <= 0) return
  const balance = await getCashDrawerBalance(shiftId)
  if (amount > balance + 0.001) {
    throw new Error(`رصيد درج النقد غير كافٍ. المتاح: ${balance.toFixed(2)}`)
  }
}

export async function listCashDrawerTransactions(
  shiftId?: string
): Promise<CashDrawerTransaction[]> {
  let txs = await getCachedDocs<CashDrawerTransaction>(COLLECTIONS.cashDrawerTransactions)
  if (shiftId) txs = txs.filter((tx) => tx.shiftId === shiftId)
  return txs.sort((a, b) => b.createdAt - a.createdAt)
}
