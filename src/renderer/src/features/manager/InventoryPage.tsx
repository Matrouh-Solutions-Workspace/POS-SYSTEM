import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { Ingredient, IngredientStock } from '@shared/types'
import {
  getIngredientStocks,
  listIngredients,
  recordPurchase,
  recordWaste,
  recordAdjustment,
  deleteIngredient
} from '@renderer/features/inventory/inventory-service'
import { ConfirmDeleteButton } from '@renderer/components/ConfirmDeleteButton'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import {
  InventoryActionModal,
  type InventoryActionType
} from './InventoryActionModal'

export function InventoryPage(): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [stocks, setStocks] = useState<IngredientStock[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [ingredientId, setIngredientId] = useState('')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [modal, setModal] = useState<{
    stock: IngredientStock
    action: InventoryActionType
  } | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [s, ing] = await Promise.all([getIngredientStocks(), listIngredients()])
    setStocks(s)
    setIngredients(ing.filter((i) => i.active))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handlePurchase(e: FormEvent): Promise<void> {
    e.preventDefault()
    const ing = ingredients.find((i) => i.id === ingredientId)
    if (!ing) return
    await recordPurchase({
      ingredientId: ing.id,
      quantity: Number(qty),
      unit: ing.unit,
      noteAr: note || undefined,
      createdBy: user.id,
      actor: user
    })
    setQty('')
    setNote('')
    await load()
  }

  async function handleModalSubmit(
    quantity: number,
    noteAr: string
  ): Promise<void> {
    if (!modal) return
    const { stock, action } = modal
    if (action === 'waste') {
      await recordWaste({
        ingredientId: stock.ingredientId,
        quantity,
        unit: stock.unit,
        noteAr: noteAr || undefined,
        createdBy: user.id,
        actor: user
      })
    } else {
      await recordAdjustment({
        ingredientId: stock.ingredientId,
        quantity,
        unit: stock.unit,
        noteAr: noteAr || undefined,
        createdBy: user.id,
        actor: user
      })
    }
    await load()
  }

  return (
    <>
      {message && (
        <p
          className={
            message.includes('فشل') || message.includes('لا يمكن')
              ? 'form-message form-message--error'
              : 'form-message form-message--ok'
          }
          role="status"
        >
          {message}
        </p>
      )}
      <div className="card">
        <h2 className="card__title">تسجيل شراء مخزون</h2>
        <form onSubmit={(e) => void handlePurchase(e)}>
          <label className="field">
            <span>المكوّن</span>
            <select
              value={ingredientId}
              onChange={(e) => setIngredientId(e.target.value)}
              required
            >
              <option value="">اختر...</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nameAr}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>الكمية (+)</span>
            <input
              type="number"
              min="0.01"
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>ملاحظة</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button type="submit" className="btn btn--primary">
            تسجيل شراء
          </button>
        </form>
      </div>
      <div className="card">
        <h2 className="card__title">المخزون الحالي (محسوب من الحركات)</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>المكوّن</th>
              <th>الكمية</th>
              <th>الوحدة</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((s) => {
              const low =
                s.lowStockThreshold != null && s.quantity <= s.lowStockThreshold
              return (
                <tr key={s.ingredientId}>
                  <td>{s.nameAr}</td>
                  <td className={low ? 'badge-low' : undefined}>
                    {s.quantity.toFixed(2)}
                  </td>
                  <td>{s.unit}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() =>
                          setModal({ stock: s, action: 'adjustment' })
                        }
                      >
                        تسوية
                      </button>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => setModal({ stock: s, action: 'waste' })}
                      >
                        هدر
                      </button>
                      <ConfirmDeleteButton
                        label="حذف"
                        confirmMessage={`حذف "${s.nameAr}" من المكوّنات؟ (يُمنع إن كان مستخدماً في وصفة)`}
                        onConfirm={async () => {
                          await deleteIngredient(s.ingredientId, user)
                          setMessage(`تم حذف "${s.nameAr}"`)
                          await load()
                        }}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {modal && (
        <InventoryActionModal
          stock={modal.stock}
          action={modal.action}
          onClose={() => setModal(null)}
          onSubmit={handleModalSubmit}
        />
      )}
    </>
  )
}
