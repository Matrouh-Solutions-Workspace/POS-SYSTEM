/**
 * Suppliers service — SQLite primary database.
 */
import type { Supplier, SupplierTransaction, SupplierTransactionType } from '@shared/types'
import { COLLECTIONS } from '@shared/constants/collections'
import { cacheDocs, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { dbDelete } from '@renderer/lib/db/sqlite-db'
import { generateId } from '@renderer/lib/utils/id'

export async function listSuppliers(activeOnly = false): Promise<Supplier[]> {
  let suppliers = await getCachedDocs<Supplier>(COLLECTIONS.suppliers)
  suppliers = suppliers.sort((a, b) => a.nameAr.localeCompare(b.nameAr, 'ar'))
  return activeOnly ? suppliers.filter((s) => s.active) : suppliers
}

export async function createSupplier(data: {
  nameAr: string
  phone?: string
  noteAr?: string
}): Promise<Supplier> {
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
  return supplier
}

export async function updateSupplier(
  id: string,
  patch: Partial<Pick<Supplier, 'nameAr' | 'phone' | 'noteAr' | 'active'>>
): Promise<void> {
  const suppliers = await getCachedDocs<Supplier>(COLLECTIONS.suppliers)
  const cached = suppliers.find((s) => s.id === id)
  if (!cached) return
  await cacheDocs(COLLECTIONS.suppliers, [{ ...cached, ...patch, updatedAt: Date.now() }])
}

export async function deleteSupplier(id: string): Promise<void> {
  const transactions = await listSupplierTransactions(id)
  await Promise.all([
    dbDelete(COLLECTIONS.suppliers, id),
    ...transactions.map((tx) => dbDelete(COLLECTIONS.supplierTransactions, tx.id))
  ])
}

export async function recordSupplierTransaction(params: {
  supplierId: string
  type: SupplierTransactionType
  amount: number
  noteAr?: string
  shiftId?: string
  createdBy: string
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
