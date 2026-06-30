/**
 * Cash drawer service — SQLite primary database.
 */
import type { CashDrawerTransaction, CashDrawerTransactionType } from '@shared/types'
import { COLLECTIONS } from '@shared/constants/collections'
import { cacheDocs, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
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
        detailAr: `Petty cash expense — amount ${Math.abs(params.amount).toFixed(2)} — reason: ${params.noteAr ?? '-'} — cash drawer impact ${params.amount.toFixed(2)}`
      })
    )
  }
  return tx
}

export async function listCashDrawerTransactions(
  shiftId?: string
): Promise<CashDrawerTransaction[]> {
  let txs = await getCachedDocs<CashDrawerTransaction>(COLLECTIONS.cashDrawerTransactions)
  if (shiftId) txs = txs.filter((tx) => tx.shiftId === shiftId)
  return txs.sort((a, b) => b.createdAt - a.createdAt)
}
