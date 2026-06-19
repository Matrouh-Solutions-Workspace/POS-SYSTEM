import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { Ingredient } from '@shared/types'
import { ConfirmDeleteButton } from '@renderer/components/ConfirmDeleteButton'
import {
  listIngredients,
  createIngredient,
  updateIngredient,
  deleteIngredient
} from '@renderer/features/inventory/inventory-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { MdEdit, MdCheck, MdClose } from 'react-icons/md'

interface EditState {
  id: string
  nameAr: string
  unit: string
  threshold: string
}

const UNITS = ['جرام', 'كيلوجرام', 'قطعة', 'مل', 'لتر']

export function IngredientsPage(): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [items, setItems] = useState<Ingredient[]>([])
  const [nameAr, setNameAr] = useState('')
  const [unit, setUnit] = useState('جرام')
  const [threshold, setThreshold] = useState('')
  const [editing, setEditing] = useState<EditState | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setItems(await listIngredients())
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleAdd(e: FormEvent): Promise<void> {
    e.preventDefault()
    await createIngredient({
      nameAr: nameAr.trim(),
      unit,
      lowStockThreshold: threshold ? Number(threshold) : undefined,
      active: true
    }, user)
    setNameAr('')
    setThreshold('')
    setMessage('تم إضافة المكوّن')
    await load()
  }

  function startEdit(i: Ingredient): void {
    setEditing({
      id: i.id,
      nameAr: i.nameAr,
      unit: i.unit,
      threshold: i.lowStockThreshold != null ? String(i.lowStockThreshold) : ''
    })
  }

  async function saveEdit(): Promise<void> {
    if (!editing) return
    await updateIngredient(editing.id, {
      nameAr: editing.nameAr.trim(),
      unit: editing.unit,
      lowStockThreshold: editing.threshold ? Number(editing.threshold) : undefined
    }, user)
    setEditing(null)
    setMessage('تم حفظ التعديلات')
    await load()
  }

  return (
    <>
      {message && (
        <p className="form-message form-message--ok" role="status">{message}</p>
      )}

      <div className="card">
        <h2 className="card__title">إضافة مكوّن</h2>
        <form onSubmit={(e) => void handleAdd(e)} className="page-toolbar">
          <label className="field" style={{ flex: 1, margin: 0 }}>
            <span>الاسم</span>
            <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} required />
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span>الوحدة</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span>حد التنبيه</span>
            <input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="اختياري"
            />
          </label>
          <button type="submit" className="btn btn--primary">إضافة</button>
        </form>
      </div>

      <div className="card">
        <h2 className="card__title">المكوّنات</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>الوحدة</th>
              <th>حد التنبيه</th>
              <th>الحالة</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const isEditing = editing?.id === i.id
              return (
                <tr key={i.id}>
                  <td>
                    {isEditing ? (
                      <input
                        className="inline-edit-input"
                        value={editing.nameAr}
                        onChange={(e) => setEditing({ ...editing, nameAr: e.target.value })}
                        autoFocus
                      />
                    ) : i.nameAr}
                  </td>
                  <td>
                    {isEditing ? (
                      <select
                        className="inline-edit-input"
                        value={editing.unit}
                        onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
                      >
                        {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    ) : i.unit}
                  </td>
                  <td>
                    {isEditing ? (
                      <input
                        className="inline-edit-input"
                        type="number"
                        value={editing.threshold}
                        onChange={(e) => setEditing({ ...editing, threshold: e.target.value })}
                        placeholder="—"
                      />
                    ) : (i.lowStockThreshold ?? '—')}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`btn btn--sm ${i.active ? 'btn--secondary' : 'btn--danger'}`}
                      onClick={() => void updateIngredient(i.id, { active: !i.active }, user).then(load)}
                    >
                      {i.active ? 'مفعّل' : 'معطّل'}
                    </button>
                  </td>
                  <td>
                    <div className="table-actions">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            onClick={() => void saveEdit()}
                            aria-label="حفظ"
                          >
                            <MdCheck /> حفظ
                          </button>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => setEditing(null)}
                            aria-label="إلغاء"
                          >
                            <MdClose />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => startEdit(i)}
                            aria-label="تعديل"
                          >
                            <MdEdit /> تعديل
                          </button>
                          <ConfirmDeleteButton
                            confirmMessage={`حذف "${i.nameAr}" نهائياً؟`}
                            onConfirm={async () => {
                              await deleteIngredient(i.id, user)
                              setMessage(`تم حذف "${i.nameAr}"`)
                              await load()
                            }}
                          />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
