import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Ingredient, IngredientStock, Supplier } from '@shared/types'
import {
  getIngredientStocks,
  listIngredients,
  recordPurchase
} from '@renderer/features/inventory/inventory-service'
import { listSuppliers, recordSupplierTransaction } from '@renderer/features/suppliers/supplier-service'
import { recordCashDrawerTransaction } from '@renderer/features/cash/cash-service'
import { getOpenShiftForCashier } from '@renderer/features/shifts/shift-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import {
  MdAddShoppingCart,
  MdCheckCircle,
  MdInventory2,
  MdSearch,
  MdWarningAmber
} from 'react-icons/md'

type StockFilter = 'all' | 'low' | 'out'

function formatStockQuantity(value: number): string {
  return value.toFixed(3).replace(/0+$/g, '').replace(/\.$/, '')
}

function stockLevel(stock: IngredientStock): 'out' | 'low' | 'ok' {
  if (stock.quantity <= 0) return 'out'
  if (stock.lowStockThreshold != null && stock.quantity <= stock.lowStockThreshold) return 'low'
  return 'ok'
}

export function CashierInventoryPage(): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [stocks, setStocks] = useState<IngredientStock[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [purchase, setPurchase] = useState({
    ingredientId: '',
    supplierId: '',
    qty: '',
    totalCost: '',
    paid: '',
    noteAr: ''
  })
  const [expense, setExpense] = useState({ amount: '', noteAr: '' })
  const [message, setMessage] = useState('')
  const [stockSearch, setStockSearch] = useState('')
  const [stockFilter, setStockFilter] = useState<StockFilter>('all')

  const load = useCallback(async () => {
    const [ing, stockRows, sup] = await Promise.all([
      listIngredients(),
      getIngredientStocks(),
      listSuppliers(true)
    ])
    setIngredients(ing.filter((i) => i.active))
    setStocks(stockRows)
    setSuppliers(sup)
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!message) return undefined
    const timeout = window.setTimeout(() => setMessage(''), 4500)
    return () => window.clearTimeout(timeout)
  }, [message])

  async function handlePurchase(e: FormEvent): Promise<void> {
    e.preventDefault()
    try {
      const ingredient = ingredients.find((i) => i.id === purchase.ingredientId)
      if (!ingredient) return
      const shift = await getOpenShiftForCashier(user.id)
      const qty = Number(purchase.qty)
      const totalCost = Math.max(0, Number(purchase.totalCost || 0))
      const paid = Math.max(0, Number(purchase.paid || 0))
      if (paid > totalCost + 0.001) {
        throw new Error('لا يمكن دفع مبلغ أكبر من قيمة التوريد')
      }
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
      if (purchase.supplierId) {
        await recordSupplierTransaction({
          supplierId: purchase.supplierId,
          type: 'purchase_credit',
          amount: totalCost,
          paidAmount: paid,
          paymentMethod: paid > 0 ? 'cash' : undefined,
          paymentSource: paid > 0 ? 'cash_drawer' : undefined,
          noteAr: purchase.noteAr || 'توريد مخزون',
          shiftId: shift?.id,
          createdBy: user.id,
          actor: user
        })
      } else if (paid > 0) {
        await recordCashDrawerTransaction({
          type: 'purchase_payment',
          amount: -paid,
          shiftId: shift?.id,
          supplierId: purchase.supplierId || undefined,
          noteAr: purchase.noteAr || 'توريد مخزون',
          createdBy: user.id,
          actor: user
        })
      }
      setPurchase({ ingredientId: '', supplierId: '', qty: '', totalCost: '', paid: '', noteAr: '' })
      setMessage('تم تسجيل التوريد')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'فشل تسجيل التوريد')
    }
  }

  async function handleExpense(e: FormEvent): Promise<void> {
    e.preventDefault()
    try {
      const shift = await getOpenShiftForCashier(user.id)
      await recordCashDrawerTransaction({
        type: 'expense',
        amount: -Math.abs(Number(expense.amount)),
        shiftId: shift?.id,
        noteAr: expense.noteAr || 'مصروفات نثرية',
        createdBy: user.id,
        actor: user
      })
      setExpense({ amount: '', noteAr: '' })
      setMessage('تم تسجيل المصروف')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'فشل تسجيل المصروف')
    }
  }

  const stockSummary = useMemo(() => {
    const out = stocks.filter((stock) => stockLevel(stock) === 'out').length
    const low = stocks.filter((stock) => stockLevel(stock) === 'low').length
    const ok = stocks.length - out - low
    return { out, low, ok, total: stocks.length }
  }, [stocks])

  const visibleStocks = useMemo(() => {
    const query = stockSearch.trim().toLowerCase()
    return stocks
      .filter((stock) => {
        const level = stockLevel(stock)
        if (stockFilter !== 'all' && level !== stockFilter) return false
        if (!query) return true
        return stock.nameAr.toLowerCase().includes(query) || stock.unit.toLowerCase().includes(query)
      })
      .sort((a, b) => {
        const rank = { out: 0, low: 1, ok: 2 }
        const levelDiff = rank[stockLevel(a)] - rank[stockLevel(b)]
        return levelDiff || a.nameAr.localeCompare(b.nameAr, 'ar')
      })
  }, [stockFilter, stockSearch, stocks])

  const urgentStocks = useMemo(
    () => stocks
      .filter((stock) => stockLevel(stock) !== 'ok')
      .sort((a, b) => {
        const rank = { out: 0, low: 1, ok: 2 }
        const levelDiff = rank[stockLevel(a)] - rank[stockLevel(b)]
        return levelDiff || a.quantity - b.quantity
      })
      .slice(0, 8),
    [stocks]
  )

  function startRestock(stock: IngredientStock): void {
    setPurchase((current) => ({ ...current, ingredientId: stock.ingredientId }))
    window.setTimeout(() => {
      document.getElementById('cashier-restock-form')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      })
    }, 0)
  }

  return (
    <div className="cashier-inventory-page">
      {message && (
        <div className={`form-message pos-floating-message ${message.includes('فشل') || message.includes('لا يمكن') ? 'form-message--error' : 'form-message--ok'}`}>
          <span>{message}</span>
          <button type="button" className="pos-floating-message__close" onClick={() => setMessage('')} aria-label="إغلاق">×</button>
        </div>
      )}

      <section className="cashier-stock-hero">
        <div>
          <h2><MdInventory2 /> المتبقي في المخزن</h2>
          <p>تابع النواقص بسرعة قبل ما تأثر على البيع، وسجل التوريد من نفس الشاشة.</p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => document.getElementById('cashier-restock-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          <MdAddShoppingCart /> توريد مخزون
        </button>
      </section>

      <section className="cashier-stock-summary" aria-label="ملخص المخزون">
        <button type="button" className={`cashier-stock-summary__card${stockFilter === 'all' ? ' cashier-stock-summary__card--active' : ''}`} onClick={() => setStockFilter('all')}>
          <span>كل الأصناف</span>
          <strong>{stockSummary.total}</strong>
        </button>
        <button type="button" className={`cashier-stock-summary__card cashier-stock-summary__card--danger${stockFilter === 'out' ? ' cashier-stock-summary__card--active' : ''}`} onClick={() => setStockFilter('out')}>
          <span>نافد</span>
          <strong>{stockSummary.out}</strong>
        </button>
        <button type="button" className={`cashier-stock-summary__card cashier-stock-summary__card--warning${stockFilter === 'low' ? ' cashier-stock-summary__card--active' : ''}`} onClick={() => setStockFilter('low')}>
          <span>قرب النفاد</span>
          <strong>{stockSummary.low}</strong>
        </button>
        <button type="button" className="cashier-stock-summary__card cashier-stock-summary__card--ok" onClick={() => setStockFilter('all')}>
          <span>متوفر</span>
          <strong>{stockSummary.ok}</strong>
        </button>
      </section>

      {urgentStocks.length > 0 && (
        <section className="cashier-stock-alert-panel">
          <div className="cashier-stock-alert-panel__header">
            <MdWarningAmber />
            <span>محتاج متابعة الآن</span>
          </div>
          <div className="cashier-stock-alert-list">
            {urgentStocks.map((stock) => {
              const level = stockLevel(stock)
              return (
                <button
                  key={stock.ingredientId}
                  type="button"
                  className={`cashier-stock-alert${level === 'out' ? ' cashier-stock-alert--out' : ''}`}
                  onClick={() => startRestock(stock)}
                >
                  <strong>{stock.nameAr}</strong>
                  <span>{level === 'out' ? 'نافد' : `${formatStockQuantity(stock.quantity)} ${stock.unit}`}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <section className="card cashier-stock-card">
        <div className="cashier-stock-toolbar">
          <label className="cashier-stock-search">
            <MdSearch aria-hidden="true" />
            <input
              value={stockSearch}
              onChange={(event) => setStockSearch(event.target.value)}
              placeholder="ابحث باسم المكون أو الوحدة"
            />
          </label>
          <div className="reports-filter__options" aria-label="تصفية المخزون">
            {([
              ['all', 'الكل'],
              ['out', 'النافد'],
              ['low', 'قرب النفاد']
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`reports-filter__btn${stockFilter === value ? ' reports-filter__btn--active' : ''}`}
                onClick={() => setStockFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="cashier-stock-list">
          {visibleStocks.map((stock) => {
            const level = stockLevel(stock)
            return (
              <article key={stock.ingredientId} className={`cashier-stock-item cashier-stock-item--${level}`}>
                <div className="cashier-stock-item__main">
                  <span className="cashier-stock-item__name">{stock.nameAr}</span>
                  <span className="cashier-stock-item__meta">
                    {stock.lowStockThreshold != null
                      ? `حد التنبيه ${formatStockQuantity(stock.lowStockThreshold)} ${stock.unit}`
                      : 'بدون حد تنبيه'}
                  </span>
                </div>
                <div className="cashier-stock-item__quantity">
                  <strong>{formatStockQuantity(stock.quantity)}</strong>
                  <span>{stock.unit}</span>
                </div>
                <span className={`cashier-stock-status cashier-stock-status--${level}`}>
                  {level === 'out' ? 'نافد' : level === 'low' ? 'قرب النفاد' : 'متوفر'}
                </span>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => startRestock(stock)}>
                  توريد
                </button>
              </article>
            )
          })}
          {visibleStocks.length === 0 && (
            <div className="cashier-stock-empty">
              <MdCheckCircle />
              <strong>لا توجد نتائج</strong>
              <span>غيّر البحث أو الفلتر لعرض مكونات أخرى.</span>
            </div>
          )}
        </div>
      </section>

      <div className="cashier-inventory-actions">
        <div className="card" id="cashier-restock-form">
          <h2 className="card__title">توريد مخزون</h2>
          <form onSubmit={(e) => void handlePurchase(e)}>
            <label className="field">
              <span>المكون</span>
              <select value={purchase.ingredientId} onChange={(e) => setPurchase((f) => ({ ...f, ingredientId: e.target.value }))} required>
                <option value="">اختر...</option>
                {ingredients.map((i) => <option key={i.id} value={i.id}>{i.nameAr}</option>)}
              </select>
            </label>
            <label className="field">
              <span>المورد</span>
              <select value={purchase.supplierId} onChange={(e) => setPurchase((f) => ({ ...f, supplierId: e.target.value }))}>
                <option value="">بدون مورد</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.nameAr}</option>)}
              </select>
            </label>
            <label className="field">
              <span>الكمية</span>
              <input type="number" min="0.01" step="any" value={purchase.qty} onChange={(e) => setPurchase((f) => ({ ...f, qty: e.target.value }))} required />
            </label>
            <label className="field">
              <span>قيمة التوريد</span>
              <input type="number" min="0" step="0.01" value={purchase.totalCost} onChange={(e) => setPurchase((f) => ({ ...f, totalCost: e.target.value }))} />
            </label>
            <label className="field">
              <span>المدفوع من الدرج</span>
              <input type="number" min="0" step="0.01" value={purchase.paid} onChange={(e) => setPurchase((f) => ({ ...f, paid: e.target.value }))} />
            </label>
            <label className="field">
              <span>ملاحظة</span>
              <input value={purchase.noteAr} onChange={(e) => setPurchase((f) => ({ ...f, noteAr: e.target.value }))} />
            </label>
            <button type="submit" className="btn btn--primary">تسجيل التوريد</button>
          </form>
        </div>

        <div className="card">
          <h2 className="card__title">مصروفات نثرية</h2>
          <form onSubmit={(e) => void handleExpense(e)}>
            <label className="field">
              <span>المبلغ</span>
              <input type="number" min="0.01" step="0.01" value={expense.amount} onChange={(e) => setExpense((f) => ({ ...f, amount: e.target.value }))} required />
            </label>
            <label className="field">
              <span>السبب</span>
              <input value={expense.noteAr} onChange={(e) => setExpense((f) => ({ ...f, noteAr: e.target.value }))} required />
            </label>
            <button type="submit" className="btn btn--primary">تسجيل المصروف</button>
          </form>
        </div>
      </div>
    </div>
  )
}
