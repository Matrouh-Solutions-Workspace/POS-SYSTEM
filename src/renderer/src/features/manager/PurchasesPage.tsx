/**
 * مشتريات — unified purchasing & inventory page.
 * Tabs: المخزون الحالي | المكوّنات
 * Replaces IngredientsPage + InventoryPage.
 *
 * Industry rationale:
 * - "المخزون الحالي" is what the manager checks daily — current stock levels,
 *   low-stock alerts, and quick purchase/waste/adjustment actions.
 * - "المكوّنات" is the master data tab — define ingredients, units,
 *   thresholds. Used less frequently (setup & maintenance).
 * This mirrors how Square, Toast, and Lightspeed structure their inventory.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { Ingredient, IngredientStock, MenuItem, Supplier } from '@shared/types'
import {
  listIngredients,
  createIngredient,
  updateIngredient,
  deleteIngredient,
  getIngredientStocks,
  recordPurchase,
  recordWaste,
  recordAdjustment,
  produceManufacturedProduct
} from '@renderer/features/inventory/inventory-service'
import { ConfirmDeleteButton } from '@renderer/components/ConfirmDeleteButton'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { InventoryActionModal, type InventoryActionType } from './InventoryActionModal'
import { MdAdd, MdEdit, MdCheck, MdClose, MdInventory, MdKitchen, MdRemove, MdSwapVert, MdWarning } from 'react-icons/md'
import { usePageState } from '@renderer/features/tabs/page-state-store'
import { FormField, FormModal } from '@renderer/components/ui'
import { listSuppliers, recordSupplierTransaction } from '@renderer/features/suppliers/supplier-service'
import { listMenuItems } from '@renderer/features/menu/menu-service'

const UNITS = ['جرام', 'كيلوجرام', 'قطعة', 'مل', 'لتر']

// ── Stock tab ───────────────────────────────────────────────────────────────

function StockTab({ stocks, ingredients, suppliers, menuItems, onRefresh, setMessage }: {
  stocks: IngredientStock[]
  ingredients: Ingredient[]
  suppliers: Supplier[]
  menuItems: MenuItem[]
  onRefresh: () => Promise<void>
  setMessage: (m: string | null) => void
}): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [ingredientId, setIngredientId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [qty, setQty] = useState('')
  const [totalCost, setTotalCost] = useState('')
  const [debtAmount, setDebtAmount] = useState('')
  const [note, setNote] = useState('')
  const [productionItemId, setProductionItemId] = useState('')
  const [productionQty, setProductionQty] = useState('')
  const [productionNote, setProductionNote] = useState('')
  const [modal, setModal] = useState<{ stock: IngredientStock; action: InventoryActionType } | null>(null)

  const activeIngredients = ingredients.filter((i) => i.active)
  const activeSuppliers = suppliers.filter((s) => s.active)
  const manufacturedItems = menuItems.filter((item) =>
    item.active &&
    item.itemType === 'product' &&
    item.productType === 'manufactured' &&
    !!item.linkedIngredientId
  )
  const lowStockCount = stocks.filter((s) => s.lowStockThreshold != null && s.quantity <= s.lowStockThreshold).length

  async function handlePurchase(e: FormEvent): Promise<void> {
    e.preventDefault()
    const ing = activeIngredients.find((i) => i.id === ingredientId)
    if (!ing) return
    const debt = Math.max(0, Number(debtAmount) || 0)
    await recordPurchase({ ingredientId: ing.id, quantity: Number(qty), unit: ing.unit, totalCost: Number(totalCost) || 0, noteAr: note || undefined, createdBy: user.id, supplierId: supplierId || undefined, actor: user })
    if (supplierId && debt > 0) {
      await recordSupplierTransaction({
        supplierId,
        type: 'purchase_credit',
        amount: debt,
        noteAr: note || `توريد مخزون: ${ing.nameAr}`,
        createdBy: user.id,
        actor: user
      })
    }
    setQty(''); setTotalCost(''); setDebtAmount(''); setNote('')
    setMessage('تم تسجيل الشراء')
    await onRefresh()
  }

  async function handleProduction(e: FormEvent): Promise<void> {
    e.preventDefault()
    try {
      await produceManufacturedProduct({
        menuItemId: productionItemId,
        quantity: Number(productionQty),
        noteAr: productionNote || undefined,
        createdBy: user.id,
        actor: user
      })
      setProductionQty('')
      setProductionNote('')
      setMessage('تم تسجيل الإنتاج وتحديث المخزون')
      await onRefresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر تسجيل الإنتاج')
    }
  }

  async function handleModalSubmit(quantity: number, noteAr: string): Promise<void> {
    if (!modal) return
    const { stock, action } = modal
    if (action === 'waste') {
      await recordWaste({ ingredientId: stock.ingredientId, quantity, unit: stock.unit, noteAr: noteAr || undefined, createdBy: user.id, actor: user })
    } else {
      await recordAdjustment({ ingredientId: stock.ingredientId, quantity, unit: stock.unit, noteAr: noteAr || undefined, createdBy: user.id, actor: user })
    }
    setMessage(action === 'waste' ? 'تم تسجيل الهدر' : 'تم تسوية المخزون')
    await onRefresh()
  }

  return (
    <div className="tab-content">
      {/* Low stock alert banner */}
      {lowStockCount > 0 && (
        <div className="stock-alert-banner">
          <MdWarning aria-hidden="true" />
          <strong>{lowStockCount}</strong> مكوّن وصل لحد التنبيه — راجع المخزون وقم بالشراء
        </div>
      )}

      {/* Quick purchase form */}
      <div className="card">
        <h2 className="card__title">تسجيل شراء سريع</h2>
        <form onSubmit={(e) => void handlePurchase(e)} className="settings-form-grid">
          <label className="field">
            <span>المكوّن</span>
            <select value={ingredientId} onChange={(e) => setIngredientId(e.target.value)} required>
              <option value="">اختر...</option>
              {activeIngredients.map((i) => <option key={i.id} value={i.id}>{i.nameAr} ({i.unit})</option>)}
            </select>
          </label>
          <label className="field">
            <span>المورد</span>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">بدون مورد</option>
              {activeSuppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.nameAr}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>الكمية المشتراة</span>
            <input className="stock-qty-input" type="number" min="0.01" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="مثال: 5" required />
          </label>
          <label className="field">
            <span>إجمالي تكلفة الشراء</span>
            <input type="number" min="0" step="0.01" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} placeholder="مثال: 750" required />
          </label>
          <label className="field">
            <span>مديونية على المورد</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={debtAmount}
              onChange={(e) => setDebtAmount(e.target.value)}
              placeholder={supplierId ? 'مثال: 250' : 'اختر موردًا أولًا'}
              disabled={!supplierId}
            />
          </label>
          <label className="field">
            <span>ملاحظة (اختياري)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: مورد الطازج" />
          </label>
          <div style={{ alignSelf: 'flex-end' }}>
            <button type="submit" className="btn btn--primary">تسجيل شراء</button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 className="card__title">إنتاج منتج مصنع</h2>
        <form onSubmit={(e) => void handleProduction(e)} className="settings-form-grid">
          <label className="field">
            <span>المنتج المصنع</span>
            <select value={productionItemId} onChange={(e) => setProductionItemId(e.target.value)} required>
              <option value="">اختر...</option>
              {manufacturedItems.map((item) => (
                <option key={item.id} value={item.id}>{item.nameAr}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>كمية الإنتاج</span>
            <input type="number" min="0.01" step="any" value={productionQty} onChange={(e) => setProductionQty(e.target.value)} placeholder="مثال: 10" required />
          </label>
          <label className="field">
            <span>ملاحظة (اختياري)</span>
            <input value={productionNote} onChange={(e) => setProductionNote(e.target.value)} placeholder="مثال: تحضير وردية المساء" />
          </label>
          <div style={{ alignSelf: 'flex-end' }}>
            <button type="submit" className="btn btn--primary" disabled={manufacturedItems.length === 0}>
              تسجيل إنتاج
            </button>
          </div>
          {manufacturedItems.length === 0 && (
            <p className="modal-hint settings-form-grid__full">
              أنشئ صنفًا من نوع منتج مصنع واربطه بمخزون، ثم أضف وصفة التصنيع من صفحة الأصناف.
            </p>
          )}
        </form>
      </div>

      {/* Stock table */}
      <div className="card">
        <h2 className="card__title">
          المخزون الحالي
          <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--color-muted)', marginRight: 8 }}>
            (محسوب تلقائياً من جميع حركات المخزون)
          </span>
        </h2>
        <table className="data-table">
          <thead>
            <tr><th>المكوّن</th><th>الرصيد</th><th>الوحدة</th><th>حد التنبيه</th><th>إجراءات</th></tr>
          </thead>
          <tbody>
            {stocks.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--color-muted)', padding: 20 }}>لا توجد بيانات مخزون بعد</td></tr>
            )}
            {stocks.map((s) => {
              const isLow = s.lowStockThreshold != null && s.quantity <= s.lowStockThreshold
              return (
                <tr key={s.ingredientId} className={isLow ? 'stock-row--low' : ''}>
                  <td>
                    {s.nameAr}
                    {isLow && <span className="stock-low-badge">نفاد قريب</span>}
                  </td>
                  <td className={isLow ? 'badge-low' : ''}>{s.quantity.toFixed(2)}</td>
                  <td>{s.unit}</td>
                  <td>{s.lowStockThreshold ?? '—'}</td>
                  <td>
                    <div className="table-actions">
                      <button type="button" className="btn btn--primary btn--sm" title="شراء: إضافة للمخزون" onClick={() => { setIngredientId(s.ingredientId); document.querySelector<HTMLInputElement>('.stock-qty-input')?.focus() }}><MdAdd /> شراء</button>
                      <button type="button" className="btn btn--secondary btn--sm" title="تسوية: تصحيح الرصيد بالزيادة أو النقص" onClick={() => setModal({ stock: s, action: 'adjustment' })}><MdSwapVert /> تسوية</button>
                      <button type="button" className="btn btn--secondary btn--sm" title="هدر: خصم من المخزون" onClick={() => setModal({ stock: s, action: 'waste' })}><MdRemove /> هدر</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {modal && (
        <InventoryActionModal stock={modal.stock} action={modal.action} onClose={() => setModal(null)} onSubmit={handleModalSubmit} />
      )}
    </div>
  )
}

// ── Ingredients tab ─────────────────────────────────────────────────────────

function IngredientsTab({ ingredients, onRefresh, setMessage }: {
  ingredients: Ingredient[]
  onRefresh: () => Promise<void>
  setMessage: (m: string | null) => void
}): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [nameAr, setNameAr] = useState('')
  const [unit, setUnit] = useState('جرام')
  const [threshold, setThreshold] = useState('')
  const [editing, setEditing] = useState<{ id: string; nameAr: string; unit: string; threshold: string } | null>(null)

  async function handleAdd(e: FormEvent): Promise<void> {
    e.preventDefault()
    await createIngredient({ nameAr: nameAr.trim(), unit, lowStockThreshold: threshold ? Number(threshold) : undefined, active: true }, user)
    setNameAr(''); setThreshold('')
    setMessage('تم إضافة المكوّن')
    await onRefresh()
  }

  async function saveEdit(): Promise<void> {
    if (!editing) return
    await updateIngredient(editing.id, { nameAr: editing.nameAr.trim(), unit: editing.unit, lowStockThreshold: editing.threshold ? Number(editing.threshold) : undefined }, user)
    setEditing(null)
    setMessage('تم حفظ التعديلات')
    await onRefresh()
  }

  return (
    <div className="tab-content">
      <div className="card">
        <h2 className="card__title">إضافة مكوّن جديد</h2>
        <form onSubmit={(e) => void handleAdd(e)} className="settings-form-grid">
          <label className="field">
            <span>الاسم</span>
            <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="مثال: طحين" required />
          </label>
          <label className="field">
            <span>وحدة القياس</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label className="field">
            <span>حد التنبيه (اختياري)</span>
            <input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="مثال: 500" />
          </label>
          <div style={{ alignSelf: 'flex-end' }}>
            <button type="submit" className="btn btn--primary">إضافة</button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 className="card__title">المكوّنات ({ingredients.length})</h2>
        <table className="data-table">
          <thead>
            <tr><th>الاسم</th><th>الوحدة</th><th>حد التنبيه</th><th>الحالة</th><th>إجراءات</th></tr>
          </thead>
          <tbody>
            {ingredients.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--color-muted)', padding: 20 }}>لا توجد مكوّنات بعد — أضف مكوّناً للبدء</td></tr>
            )}
            {ingredients.map((i) => {
              return (
                <tr key={i.id}>
                  <td>{i.nameAr}</td>
                  <td>{i.unit}</td>
                  <td>{i.lowStockThreshold ?? '—'}</td>
                  <td>
                    <button type="button" className={`btn btn--sm ${i.active ? 'btn--secondary' : 'btn--danger'}`} onClick={() => void updateIngredient(i.id, { active: !i.active }, user).then(onRefresh)}>
                      {i.active ? 'مفعّل' : 'معطّل'}
                    </button>
                  </td>
                  <td>
                    <div className="table-actions">
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditing({ id: i.id, nameAr: i.nameAr, unit: i.unit, threshold: i.lowStockThreshold != null ? String(i.lowStockThreshold) : '' })}><MdEdit /> تعديل</button>
                      <ConfirmDeleteButton confirmMessage={`حذف "${i.nameAr}" نهائياً؟`} onConfirm={async () => { await deleteIngredient(i.id, user); setMessage(`تم حذف "${i.nameAr}"`); await onRefresh() }} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <FormModal
          open={true}
          title={`تعديل المكون: ${ingredients.find(i => i.id === editing.id)?.nameAr || ''}`}
          entityName="مكون"
          isEdit={true}
          onClose={() => setEditing(null)}
          onSubmit={saveEdit}
        >
          <FormField label="الاسم" required>
            <input value={editing.nameAr} onChange={(e) => setEditing({...editing, nameAr: e.target.value})} autoFocus required />
          </FormField>
          <FormField label="وحدة القياس">
            <select value={editing.unit} onChange={(e) => setEditing({...editing, unit: e.target.value})}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </FormField>
          <FormField label="حد التنبيه (اختياري)">
            <input type="number" value={editing.threshold} onChange={(e) => setEditing({...editing, threshold: e.target.value})} placeholder="مثال: 500" />
          </FormField>
        </FormModal>
      )}
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────

type PurchasesTab = 'stock' | 'ingredients'

export function PurchasesPage(): React.ReactElement {
  const { saved, save } = usePageState<{ activeTab: PurchasesTab }>('/manager/purchases')
  const [activeTab, setActiveTab] = useState<PurchasesTab>(saved.activeTab ?? 'stock')
  const [stocks, setStocks] = useState<IngredientStock[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const tabListRef = useRef<HTMLDivElement>(null)
  const stockTabRef = useRef<HTMLDivElement>(null)
  const ingredientsTabRef = useRef<HTMLDivElement>(null)

  useEffect(() => { save({ activeTab }) }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    const [s, ing, supplierList, menu] = await Promise.all([getIngredientStocks(), listIngredients(), listSuppliers(), listMenuItems()])
    setStocks(s)
    setIngredients(ing)
    setSuppliers(supplierList)
    setMenuItems(menu)
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 4000)
    return () => clearTimeout(t)
  }, [message])

  const lowCount = stocks.filter((s) => s.lowStockThreshold != null && s.quantity <= s.lowStockThreshold).length

  const tabs: { key: PurchasesTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: 'stock',       label: 'المخزون الحالي', icon: <MdInventory />, badge: lowCount || undefined },
    { key: 'ingredients', label: 'المكوّنات',       icon: <MdKitchen />,   badge: undefined },
  ]

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (!e.ctrlKey) return
      if (e.key === 's') {
        e.preventDefault()
        const scope = activeTab === 'stock' ? stockTabRef.current : ingredientsTabRef.current
        const form = scope?.querySelector<HTMLFormElement>('form')
        form?.requestSubmit()
        return
      }
      if (e.key === '1' || e.key === '2') {
        e.preventDefault()
        setActiveTab(e.key === '1' ? 'stock' : 'ingredients')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTab])

  return (
    <div className="unified-page">
      <div
        ref={tabListRef}
        className="inner-tabs"
        role="tablist"
        onKeyDown={(e) => {
          const currentIndex = tabs.findIndex((t) => t.key === activeTab)
          if (currentIndex === -1) return
          let nextIndex = currentIndex
          if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length
          else if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
          else if (e.key === 'Home') nextIndex = 0
          else if (e.key === 'End') nextIndex = tabs.length - 1
          else return
          e.preventDefault()
          setActiveTab(tabs[nextIndex]!.key)
          const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
          buttons?.[nextIndex]?.focus()
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={activeTab === t.key}
            className={`inner-tab${activeTab === t.key ? ' inner-tab--active' : ''}`}
            onClick={() => setActiveTab(t.key)}
            tabIndex={activeTab === t.key ? 0 : -1}
          >
            {t.icon}
            {t.label}
            {t.badge !== undefined && <span className="inner-tab__count inner-tab__count--danger">{t.badge}</span>}
          </button>
        ))}
      </div>

      {message && (
        <p className={`form-message ${message.includes('فشل')||message.includes('لا يمكن') ? 'form-message--error' : 'form-message--ok'}`} role="status">{message}</p>
      )}

      {activeTab === 'stock' && (
        <div ref={stockTabRef} className="unified-page__panel">
          <StockTab stocks={stocks} ingredients={ingredients} suppliers={suppliers} menuItems={menuItems} onRefresh={load} setMessage={setMessage} />
        </div>
      )}
      {activeTab === 'ingredients' && (
        <div ref={ingredientsTabRef} className="unified-page__panel">
          <IngredientsTab ingredients={ingredients} onRefresh={load} setMessage={setMessage} />
        </div>
      )}
    </div>
  )
}
