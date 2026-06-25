import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { Ingredient, Supplier } from '@shared/types'
import { listIngredients, recordPurchase } from '@renderer/features/inventory/inventory-service'
import { listSuppliers, recordSupplierTransaction } from '@renderer/features/suppliers/supplier-service'
import { recordCashDrawerTransaction } from '@renderer/features/cash/cash-service'
import { getOpenShiftForCashier } from '@renderer/features/shifts/shift-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'

export function CashierInventoryPage(): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [purchase, setPurchase] = useState({ ingredientId: '', supplierId: '', qty: '', totalCost: '', paid: '', noteAr: '' })
  const [expense, setExpense] = useState({ amount: '', noteAr: '' })
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const [ing, sup] = await Promise.all([listIngredients(), listSuppliers(true)])
    setIngredients(ing.filter((i) => i.active))
    setSuppliers(sup)
  }, [])

  useEffect(() => { void load() }, [load])

  async function handlePurchase(e: FormEvent): Promise<void> {
    e.preventDefault()
    const ingredient = ingredients.find((i) => i.id === purchase.ingredientId)
    if (!ingredient) return
    const shift = await getOpenShiftForCashier(user.id)
    const qty = Number(purchase.qty)
    const totalCost = Math.max(0, Number(purchase.totalCost || 0))
    const paid = Math.max(0, Number(purchase.paid || 0))
    await recordPurchase({
      ingredientId: ingredient.id,
      quantity: qty,
      unit: ingredient.unit,
      totalCost,
      noteAr: purchase.noteAr || undefined,
      createdBy: user.id,
      supplierId: purchase.supplierId || undefined,
      shiftId: shift?.id,
      actor: user
    })
    if (paid > 0) {
      await recordCashDrawerTransaction({
        type: 'purchase_payment',
        amount: -paid,
        shiftId: shift?.id,
        supplierId: purchase.supplierId || undefined,
        noteAr: purchase.noteAr || 'توريد مخزون',
        createdBy: user.id
      })
    }
    if (purchase.supplierId && totalCost > paid) {
      await recordSupplierTransaction({
        supplierId: purchase.supplierId,
        type: 'purchase_credit',
        amount: totalCost - paid,
        noteAr: purchase.noteAr || 'توريد على الحساب',
        shiftId: shift?.id,
        createdBy: user.id,
        actor: user
      })
    }
    setPurchase({ ingredientId: '', supplierId: '', qty: '', totalCost: '', paid: '', noteAr: '' })
    setMessage('تم تسجيل التوريد')
  }

  async function handleExpense(e: FormEvent): Promise<void> {
    e.preventDefault()
    const shift = await getOpenShiftForCashier(user.id)
    await recordCashDrawerTransaction({
      type: 'expense',
      amount: -Math.abs(Number(expense.amount)),
      shiftId: shift?.id,
      noteAr: expense.noteAr || 'مصروفات نثرية',
      createdBy: user.id
    })
    setExpense({ amount: '', noteAr: '' })
    setMessage('تم تسجيل المصروف')
  }

  return (
    <div className="settings-page">
      {message && <p className="form-message form-message--ok">{message}</p>}
      <div className="card">
        <h2 className="card__title">توريد مخزون</h2>
        <form onSubmit={(e) => void handlePurchase(e)}>
          <label className="field"><span>المكون</span><select value={purchase.ingredientId} onChange={(e) => setPurchase((f) => ({ ...f, ingredientId: e.target.value }))} required><option value="">اختر...</option>{ingredients.map((i) => <option key={i.id} value={i.id}>{i.nameAr}</option>)}</select></label>
          <label className="field"><span>المورد</span><select value={purchase.supplierId} onChange={(e) => setPurchase((f) => ({ ...f, supplierId: e.target.value }))}><option value="">بدون مورد</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.nameAr}</option>)}</select></label>
          <label className="field"><span>الكمية</span><input type="number" min="0.01" step="any" value={purchase.qty} onChange={(e) => setPurchase((f) => ({ ...f, qty: e.target.value }))} required /></label>
          <label className="field"><span>قيمة التوريد</span><input type="number" min="0" step="0.01" value={purchase.totalCost} onChange={(e) => setPurchase((f) => ({ ...f, totalCost: e.target.value }))} /></label>
          <label className="field"><span>المدفوع من الدرج</span><input type="number" min="0" step="0.01" value={purchase.paid} onChange={(e) => setPurchase((f) => ({ ...f, paid: e.target.value }))} /></label>
          <label className="field"><span>ملاحظة</span><input value={purchase.noteAr} onChange={(e) => setPurchase((f) => ({ ...f, noteAr: e.target.value }))} /></label>
          <button type="submit" className="btn btn--primary">تسجيل التوريد</button>
        </form>
      </div>
      <div className="card">
        <h2 className="card__title">مصروفات نثرية</h2>
        <form onSubmit={(e) => void handleExpense(e)}>
          <label className="field"><span>المبلغ</span><input type="number" min="0.01" step="0.01" value={expense.amount} onChange={(e) => setExpense((f) => ({ ...f, amount: e.target.value }))} required /></label>
          <label className="field"><span>السبب</span><input value={expense.noteAr} onChange={(e) => setExpense((f) => ({ ...f, noteAr: e.target.value }))} required /></label>
          <button type="submit" className="btn btn--primary">تسجيل المصروف</button>
        </form>
      </div>
    </div>
  )
}
