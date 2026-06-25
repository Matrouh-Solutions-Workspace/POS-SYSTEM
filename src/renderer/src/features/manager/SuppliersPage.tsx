import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { Ingredient, InventoryBatch, Supplier, SupplierTransaction, SupplierTransactionType } from '@shared/types'
import {
  createSupplier,
  deleteSupplier,
  getSupplierBalance,
  listSupplierTransactions,
  listSuppliers,
  recordSupplierTransaction,
  updateSupplier
} from '@renderer/features/suppliers/supplier-service'
import { recordCashDrawerTransaction } from '@renderer/features/cash/cash-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { ConfirmDeleteButton } from '@renderer/components/ConfirmDeleteButton'
import { listIngredients, listInventoryBatches } from '@renderer/features/inventory/inventory-service'
import {
  createSupplierReturn,
  listSupplierReturnReport,
  type SupplierReturnReportRow
} from '@renderer/features/suppliers/supplier-return-service'

const TX_TYPES: Array<{ value: SupplierTransactionType; label: string }> = [
  { value: 'purchase_credit', label: 'توريد على الحساب' },
  { value: 'payment', label: 'دفعة للمورد' },
  { value: 'debt_increase', label: 'زيادة مديونية' },
  { value: 'debt_decrease', label: 'تقليل مديونية' },
  { value: 'settlement', label: 'تصفية حساب' }
]

export function SuppliersPage(): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [transactions, setTransactions] = useState<SupplierTransaction[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [batches, setBatches] = useState<InventoryBatch[]>([])
  const [returns, setReturns] = useState<SupplierReturnReportRow[]>([])
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [form, setForm] = useState({ nameAr: '', phone: '', noteAr: '' })
  const [txForm, setTxForm] = useState({
    supplierId: '',
    type: 'payment' as SupplierTransactionType,
    amount: '',
    noteAr: ''
  })
  const [message, setMessage] = useState('')
  const [returnForm, setReturnForm] = useState({
    supplierId: '',
    ingredientId: '',
    quantity: '',
    reason: ''
  })
  const [returnFilters, setReturnFilters] = useState({ supplierId: '', ingredientId: '', from: '', to: '' })

  const load = useCallback(async () => {
    const [list, txs, ingredientList, batchList, returnList] = await Promise.all([
      listSuppliers(),
      listSupplierTransactions(),
      listIngredients(),
      listInventoryBatches(),
      listSupplierReturnReport()
    ])
    setSuppliers(list)
    setTransactions(txs.slice(0, 100))
    setIngredients(ingredientList)
    setBatches(batchList)
    setReturns(returnList)
    const pairs = await Promise.all(list.map(async (s) => [s.id, await getSupplierBalance(s.id)] as const))
    setBalances(Object.fromEntries(pairs))
  }, [])

  async function handleReturn(e: FormEvent): Promise<void> {
    e.preventDefault()
    try {
      await createSupplierReturn({
        supplierId: returnForm.supplierId,
        ingredientId: returnForm.ingredientId,
        quantity: Number(returnForm.quantity),
        reason: returnForm.reason,
        actor: user
      })
      setReturnForm((form) => ({ ...form, quantity: '', reason: '' }))
      setMessage('تم تسجيل مرتجع المورد وتحديث المخزون وحساب المورد')
      await load()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'تعذر تسجيل مرتجع المورد')
    }
  }

  async function applyReturnFilters(): Promise<void> {
    setReturns(await listSupplierReturnReport({
      supplierId: returnFilters.supplierId || undefined,
      ingredientId: returnFilters.ingredientId || undefined,
      from: returnFilters.from ? new Date(`${returnFilters.from}T00:00:00`).getTime() : undefined,
      to: returnFilters.to ? new Date(`${returnFilters.to}T23:59:59.999`).getTime() : undefined
    }))
  }

  useEffect(() => { void load() }, [load])

  async function handleCreate(e: FormEvent): Promise<void> {
    e.preventDefault()
    await createSupplier({
      nameAr: form.nameAr.trim(),
      phone: form.phone || undefined,
      noteAr: form.noteAr || undefined
    }, user)
    setForm({ nameAr: '', phone: '', noteAr: '' })
    setMessage('تم إضافة المورد')
    await load()
  }

  async function handleTx(e: FormEvent): Promise<void> {
    e.preventDefault()
    const amount = Math.abs(Number(txForm.amount))
    if (!txForm.supplierId || !amount) return
    await recordSupplierTransaction({
      supplierId: txForm.supplierId,
      type: txForm.type,
      amount,
      noteAr: txForm.noteAr || undefined,
      createdBy: user.id,
      actor: user
    })
    if (txForm.type === 'payment' || txForm.type === 'settlement') {
      await recordCashDrawerTransaction({
        type: 'supplier_payment',
        amount: -amount,
        supplierId: txForm.supplierId,
        noteAr: txForm.noteAr || 'دفع مورد',
        createdBy: user.id
      })
    }
    setTxForm((f) => ({ ...f, amount: '', noteAr: '' }))
    setMessage('تم تسجيل حركة المورد')
    await load()
  }

  return (
    <>
      {message && <p className={`form-message ${message.includes('تعذر') || message.includes('اختر') || message.includes('الكمية') ? 'form-message--error' : 'form-message--ok'}`}>{message}</p>}
      <div className="settings-page">
        <div className="card">
          <h2 className="card__title">إضافة مورد</h2>
          <form onSubmit={(e) => void handleCreate(e)}>
            <label className="field"><span>اسم المورد</span><input value={form.nameAr} onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))} required /></label>
            <label className="field"><span>الهاتف</span><input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} dir="ltr" /></label>
            <label className="field"><span>ملاحظة</span><input value={form.noteAr} onChange={(e) => setForm((f) => ({ ...f, noteAr: e.target.value }))} /></label>
            <button type="submit" className="btn btn--primary">حفظ المورد</button>
          </form>
        </div>

        <div className="card">
          <h2 className="card__title">حركة حساب مورد</h2>
          <form onSubmit={(e) => void handleTx(e)}>
            <label className="field">
              <span>المورد</span>
              <select value={txForm.supplierId} onChange={(e) => setTxForm((f) => ({ ...f, supplierId: e.target.value }))} required>
                <option value="">اختر...</option>
                {suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.nameAr}</option>)}
              </select>
            </label>
            <label className="field">
              <span>نوع الحركة</span>
              <select value={txForm.type} onChange={(e) => setTxForm((f) => ({ ...f, type: e.target.value as SupplierTransactionType }))}>
                {TX_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="field"><span>المبلغ</span><input type="number" min="0.01" step="0.01" value={txForm.amount} onChange={(e) => setTxForm((f) => ({ ...f, amount: e.target.value }))} required /></label>
            <label className="field"><span>السبب / الملاحظة</span><input value={txForm.noteAr} onChange={(e) => setTxForm((f) => ({ ...f, noteAr: e.target.value }))} /></label>
            <button type="submit" className="btn btn--primary">تسجيل الحركة</button>
          </form>
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">الموردين</h2>
        <table className="data-table">
          <thead><tr><th>الاسم</th><th>الهاتف</th><th>الرصيد</th><th>الحالة</th><th>إجراءات</th></tr></thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id}>
                <td>{s.nameAr}</td>
                <td dir="ltr">{s.phone ?? '-'}</td>
                <td>{(balances[s.id] ?? 0).toFixed(2)}</td>
                <td>
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => void updateSupplier(s.id, { active: !s.active }, user).then(load)}>
                    {s.active ? 'مفعل' : 'معطل'}
                  </button>
                </td>
                <td>
                  <ConfirmDeleteButton
                    confirmMessage={`حذف المورد "${s.nameAr}" وكل حركاته؟`}
                    onConfirm={async () => {
                      await deleteSupplier(s.id, user)
                      setMessage(`تم حذف المورد "${s.nameAr}"`)
                      await load()
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 className="card__title">تسجيل مرتجع إلى مورد</h2>
        <form onSubmit={(e) => void handleReturn(e)} className="settings-form-grid">
          <label className="field">
            <span>المورد</span>
            <select value={returnForm.supplierId} onChange={(e) => setReturnForm((form) => ({ ...form, supplierId: e.target.value, ingredientId: '' }))} required>
              <option value="">اختر...</option>
              {suppliers.filter((supplier) => supplier.active).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.nameAr}</option>)}
            </select>
          </label>
          <label className="field">
            <span>الصنف المشترى</span>
            <select value={returnForm.ingredientId} onChange={(e) => setReturnForm((form) => ({ ...form, ingredientId: e.target.value }))} required>
              <option value="">اختر...</option>
              {ingredients
                .filter((ingredient) => ingredient.active && batches.some((batch) =>
                  batch.supplierId === returnForm.supplierId &&
                  batch.ingredientId === ingredient.id &&
                  batch.remainingQuantity > 0
                ))
                .map((ingredient) => {
                  const available = batches
                    .filter((batch) => batch.supplierId === returnForm.supplierId && batch.ingredientId === ingredient.id)
                    .reduce((sum, batch) => sum + batch.remainingQuantity, 0)
                  return <option key={ingredient.id} value={ingredient.id}>{ingredient.nameAr} ({available.toFixed(3)} {ingredient.unit} متاح)</option>
                })}
            </select>
          </label>
          <label className="field"><span>الكمية المرتجعة</span><input type="number" min="0.001" step="any" value={returnForm.quantity} onChange={(e) => setReturnForm((form) => ({ ...form, quantity: e.target.value }))} required /></label>
          <label className="field"><span>سبب المرتجع</span><input value={returnForm.reason} onChange={(e) => setReturnForm((form) => ({ ...form, reason: e.target.value }))} required /></label>
          <div style={{ alignSelf: 'flex-end' }}><button type="submit" className="btn btn--danger">تأكيد المرتجع</button></div>
        </form>
      </div>

      <div className="card">
        <h2 className="card__title">سجل عمليات التوريد</h2>
        <table className="data-table">
          <thead>
            <tr><th>الوقت</th><th>المورد</th><th>نوع الحركة</th><th>المبلغ</th><th>ملاحظة</th></tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--color-muted)' }}>لا توجد عمليات توريد بعد</td></tr>
            ) : transactions.map((tx) => (
              <tr key={tx.id}>
                <td>{new Date(tx.createdAt).toLocaleString('ar-EG')}</td>
                <td>{suppliers.find((s) => s.id === tx.supplierId)?.nameAr ?? tx.supplierId}</td>
                <td>{TX_TYPES.find((t) => t.value === tx.type)?.label ?? tx.type}</td>
                <td>{tx.amount.toFixed(2)}</td>
                <td>{tx.noteAr ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 className="card__title">سجل مرتجعات الموردين</h2>
        <div className="settings-form-grid" style={{ marginBottom: 12 }}>
          <label className="field"><span>من</span><input type="date" value={returnFilters.from} onChange={(e) => setReturnFilters((filters) => ({ ...filters, from: e.target.value }))} /></label>
          <label className="field"><span>إلى</span><input type="date" value={returnFilters.to} onChange={(e) => setReturnFilters((filters) => ({ ...filters, to: e.target.value }))} /></label>
          <label className="field"><span>المورد</span><select value={returnFilters.supplierId} onChange={(e) => setReturnFilters((filters) => ({ ...filters, supplierId: e.target.value }))}><option value="">الكل</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.nameAr}</option>)}</select></label>
          <label className="field"><span>الصنف</span><select value={returnFilters.ingredientId} onChange={(e) => setReturnFilters((filters) => ({ ...filters, ingredientId: e.target.value }))}><option value="">الكل</option>{ingredients.map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.nameAr}</option>)}</select></label>
          <div style={{ alignSelf: 'flex-end' }}><button type="button" className="btn btn--secondary" onClick={() => void applyReturnFilters()}>تطبيق الفلاتر</button></div>
        </div>
        <table className="data-table">
          <thead><tr><th>التاريخ</th><th>المورد</th><th>الصنف</th><th>الكمية</th><th>قيمة المرتجع</th><th>المستخدم</th><th>السبب</th></tr></thead>
          <tbody>
            {returns.length === 0 ? <tr><td colSpan={7} style={{ textAlign: 'center' }}>لا توجد مرتجعات</td></tr> : returns.flatMap((record) => record.items.map((item) => (
              <tr key={item.id}>
                <td>{new Date(record.createdAt).toLocaleString('ar-EG')}</td>
                <td>{record.supplierName}</td>
                <td>{item.ingredientName}</td>
                <td>{item.quantity.toFixed(3)} {item.unit}</td>
                <td>{item.totalCost.toFixed(2)}</td>
                <td>{record.userName}</td>
                <td>{record.reason}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </>
  )
}
