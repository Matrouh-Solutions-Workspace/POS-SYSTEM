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
import { ConfirmDialog, FormModal, FormField } from '@renderer/components/ui'
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
  
  const [message, setMessage] = useState('')
  const [supplierToDelete, setSupplierToDelete] = useState<string | null>(null)

  // Modal states
  const [supplierFormOpen, setSupplierFormOpen] = useState(false)
  const [txFormOpen, setTxFormOpen] = useState(false)
  const [returnFormOpen, setReturnFormOpen] = useState(false)

  const [form, setForm] = useState({ nameAr: '', phone: '', noteAr: '' })
  const [txForm, setTxForm] = useState({
    supplierId: '',
    type: 'payment' as SupplierTransactionType,
    amount: '',
    noteAr: ''
  })
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

  useEffect(() => { void load() }, [load])

  async function handleCreate(e?: FormEvent): Promise<void> {
    if (e) e.preventDefault()
    if (!form.nameAr.trim()) throw new Error('يرجى إدخال اسم المورد')
    await createSupplier({
      nameAr: form.nameAr.trim(),
      phone: form.phone || undefined,
      noteAr: form.noteAr || undefined
    }, user)
    setForm({ nameAr: '', phone: '', noteAr: '' })
    setMessage('تم إضافة المورد')
    setSupplierFormOpen(false)
    await load()
  }

  async function handleTx(e?: FormEvent): Promise<void> {
    if (e) e.preventDefault()
    const amount = Math.abs(Number(txForm.amount))
    if (!txForm.supplierId) throw new Error('يرجى اختيار المورد')
    if (!amount) throw new Error('يرجى إدخال المبلغ بشكل صحيح')
    
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
    setTxFormOpen(false)
    await load()
  }

  async function handleReturn(e?: FormEvent): Promise<void> {
    if (e) e.preventDefault()
    if (!returnForm.supplierId) throw new Error('يرجى اختيار المورد')
    if (!returnForm.ingredientId) throw new Error('يرجى اختيار الصنف')
    if (!returnForm.quantity || Number(returnForm.quantity) <= 0) throw new Error('يرجى إدخال كمية صحيحة')
    if (!returnForm.reason.trim()) throw new Error('يرجى إدخال سبب المرتجع')

    await createSupplierReturn({
      supplierId: returnForm.supplierId,
      ingredientId: returnForm.ingredientId,
      quantity: Number(returnForm.quantity),
      reason: returnForm.reason,
      actor: user
    })
    setReturnForm((form) => ({ ...form, quantity: '', reason: '' }))
    setMessage('تم تسجيل مرتجع المورد وتحديث المخزون وحساب المورد')
    setReturnFormOpen(false)
    await load()
  }

  async function applyReturnFilters(): Promise<void> {
    setReturns(await listSupplierReturnReport({
      supplierId: returnFilters.supplierId || undefined,
      ingredientId: returnFilters.ingredientId || undefined,
      from: returnFilters.from ? new Date(`${returnFilters.from}T00:00:00`).getTime() : undefined,
      to: returnFilters.to ? new Date(`${returnFilters.to}T23:59:59.999`).getTime() : undefined
    }))
  }

  return (
    <>
      {message && <p className={`form-message ${message.includes('تعذر') || message.includes('فشل') ? 'form-message--error' : 'form-message--ok'}`}>{message}</p>}
      
      <div className="settings-page">
        <div className="card">
          <div className="page-toolbar mb-16">
            <h2 className="card__title m-0">الموردين ({suppliers.length})</h2>
            <button type="button" className="btn btn--primary" onClick={() => { setForm({ nameAr: '', phone: '', noteAr: '' }); setSupplierFormOpen(true) }}>+ إضافة مورد</button>
          </div>
          <table className="data-table">
            <thead><tr><th>الاسم</th><th>الهاتف</th><th>الرصيد</th><th>الحالة</th><th>إجراءات</th></tr></thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td>{s.nameAr}</td>
                  <td dir="ltr">{s.phone ?? '-'}</td>
                  <td>{(balances[s.id] ?? 0).toFixed(2)}</td>
                  <td>
                    <button type="button" className={`btn btn--sm ${s.active ? 'btn--secondary' : 'btn--danger'}`} onClick={() => void updateSupplier(s.id, { active: !s.active }, user).then(load)}>
                      {s.active ? 'مفعل' : 'معطل'}
                    </button>
                  </td>
                  <td>
                    <div className="table-actions">
                      <ConfirmDialog
                        open={supplierToDelete === s.id}
                        onCancel={() => setSupplierToDelete(null)}
                        onConfirm={async () => {
                          await deleteSupplier(s.id, user)
                          setMessage(`تم حذف المورد "${s.nameAr}"`)
                          setSupplierToDelete(null)
                          await load()
                        }}
                        title="تأكيد الحذف"
                        message={`حذف المورد "${s.nameAr}" وكل حركاته؟`}
                        confirmLabel="حذف"
                        danger
                      />
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        onClick={() => setSupplierToDelete(s.id)}
                      >
                        حذف
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {suppliers.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--color-muted)' }}>لا يوجد موردين بعد</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="page-toolbar mb-16">
            <h2 className="card__title m-0">سجل عمليات التوريد</h2>
            <button type="button" className="btn btn--primary" onClick={() => { setTxForm({ supplierId: '', type: 'payment', amount: '', noteAr: '' }); setTxFormOpen(true) }}>+ إضافة حركة حساب</button>
          </div>
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
          <div className="page-toolbar mb-16">
            <h2 className="card__title m-0">سجل مرتجعات الموردين</h2>
            <button type="button" className="btn btn--danger" onClick={() => { setReturnForm({ supplierId: '', ingredientId: '', quantity: '', reason: '' }); setReturnFormOpen(true) }}>+ تسجيل مرتجع</button>
          </div>
          <div className="settings-form-grid mb-12">
            <label className="field"><span>من</span><input type="date" value={returnFilters.from} onChange={(e) => setReturnFilters((filters) => ({ ...filters, from: e.target.value }))} /></label>
            <label className="field"><span>إلى</span><input type="date" value={returnFilters.to} onChange={(e) => setReturnFilters((filters) => ({ ...filters, to: e.target.value }))} /></label>
            <label className="field"><span>المورد</span><select value={returnFilters.supplierId} onChange={(e) => setReturnFilters((filters) => ({ ...filters, supplierId: e.target.value }))}><option value="">الكل</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.nameAr}</option>)}</select></label>
            <label className="field"><span>الصنف</span><select value={returnFilters.ingredientId} onChange={(e) => setReturnFilters((filters) => ({ ...filters, ingredientId: e.target.value }))}><option value="">الكل</option>{ingredients.map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.nameAr}</option>)}</select></label>
            <div style={{ alignSelf: 'flex-end' }}><button type="button" className="btn btn--secondary" onClick={() => void applyReturnFilters()}>تطبيق الفلاتر</button></div>
          </div>
          <table className="data-table">
            <thead><tr><th>التاريخ</th><th>المورد</th><th>الصنف</th><th>الكمية</th><th>قيمة المرتجع</th><th>المستخدم</th><th>السبب</th></tr></thead>
            <tbody>
              {returns.length === 0 ? <tr><td colSpan={7} className="text-center">لا توجد مرتجعات</td></tr> : returns.flatMap((record) => record.items.map((item) => (
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
      </div>

      {/* MODALS */}
      <FormModal
        open={supplierFormOpen}
        onClose={() => setSupplierFormOpen(false)}
        entityName="مورد"
        isEdit={false}
        onSubmit={handleCreate}
        maxWidth={500}
      >
        <div className="settings-form-grid grid-cols-1">
          <FormField label="اسم المورد" required>
            <input 
              value={form.nameAr} 
              onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))} 
              required 
              autoFocus
            />
          </FormField>
          <FormField label="الهاتف">
            <input 
              value={form.phone} 
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} 
              dir="ltr" 
            />
          </FormField>
          <FormField label="ملاحظة">
            <input 
              value={form.noteAr} 
              onChange={(e) => setForm((f) => ({ ...f, noteAr: e.target.value }))} 
            />
          </FormField>
        </div>
      </FormModal>

      <FormModal
        open={txFormOpen}
        onClose={() => setTxFormOpen(false)}
        entityName="حركة مورد"
        isEdit={false}
        onSubmit={handleTx}
        maxWidth={500}
      >
        <div className="settings-form-grid grid-cols-1">
          <FormField label="المورد" required>
            <select 
              value={txForm.supplierId} 
              onChange={(e) => setTxForm((f) => ({ ...f, supplierId: e.target.value }))} 
              required
              autoFocus
            >
              <option value="">اختر...</option>
              {suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.nameAr}</option>)}
            </select>
          </FormField>
          <FormField label="نوع الحركة" required>
            <select 
              value={txForm.type} 
              onChange={(e) => setTxForm((f) => ({ ...f, type: e.target.value as SupplierTransactionType }))}
              required
            >
              {TX_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </FormField>
          <FormField label="المبلغ" required>
            <input 
              type="number" 
              min="0.01" 
              step="0.01" 
              value={txForm.amount} 
              onChange={(e) => setTxForm((f) => ({ ...f, amount: e.target.value }))} 
              required 
            />
          </FormField>
          <FormField label="السبب / الملاحظة">
            <input 
              value={txForm.noteAr} 
              onChange={(e) => setTxForm((f) => ({ ...f, noteAr: e.target.value }))} 
            />
          </FormField>
        </div>
      </FormModal>

      <FormModal
        open={returnFormOpen}
        onClose={() => setReturnFormOpen(false)}
        entityName="مرتجع مورد"
        isEdit={false}
        onSubmit={handleReturn}
        maxWidth={500}
      >
        <div className="settings-form-grid grid-cols-1">
          <FormField label="المورد" required>
            <select 
              value={returnForm.supplierId} 
              onChange={(e) => setReturnForm((form) => ({ ...form, supplierId: e.target.value, ingredientId: '' }))} 
              required
              autoFocus
            >
              <option value="">اختر...</option>
              {suppliers.filter((supplier) => supplier.active).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.nameAr}</option>)}
            </select>
          </FormField>
          <FormField label="الصنف المشترى" required>
            <select 
              value={returnForm.ingredientId} 
              onChange={(e) => setReturnForm((form) => ({ ...form, ingredientId: e.target.value }))} 
              required
              disabled={!returnForm.supplierId}
            >
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
          </FormField>
          <FormField label="الكمية المرتجعة" required>
            <input 
              type="number" 
              min="0.001" 
              step="any" 
              value={returnForm.quantity} 
              onChange={(e) => setReturnForm((form) => ({ ...form, quantity: e.target.value }))} 
              required 
            />
          </FormField>
          <FormField label="سبب المرتجع" required>
            <input 
              value={returnForm.reason} 
              onChange={(e) => setReturnForm((form) => ({ ...form, reason: e.target.value }))} 
              required 
            />
          </FormField>
        </div>
      </FormModal>
    </>
  )
}
