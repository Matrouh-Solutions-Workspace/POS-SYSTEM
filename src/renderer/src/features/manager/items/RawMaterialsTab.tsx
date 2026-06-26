import React, { useState, FormEvent } from 'react'
import { Ingredient } from '@shared/types'
import { createIngredient, updateIngredient, deleteIngredient } from '@renderer/features/inventory/inventory-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { ConfirmDialog, FormModal, FormField } from '@renderer/components/ui'
import { MdEdit, MdDelete } from 'react-icons/md'

export function RawMaterialsTab({ ingredients, onRefresh, setMessage }: {
  ingredients: Ingredient[]
  onRefresh: () => Promise<void>
  setMessage: (m: string | null) => void
}): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [formOpen, setFormOpen] = useState(false)
  const [editingIng, setEditingIng] = useState<Ingredient | null>(null)
  
  const [nameAr, setNameAr] = useState('')
  const [unit, setUnit] = useState('جرام')
  const [threshold, setThreshold] = useState('')
  
  const [itemToDelete, setItemToDelete] = useState<string | null>(null)

  function openCreate() {
    setEditingIng(null)
    setNameAr('')
    setUnit('جرام')
    setThreshold('')
    setFormOpen(true)
  }

  function openEdit(ing: Ingredient) {
    setEditingIng(ing)
    setNameAr(ing.nameAr)
    setUnit(ing.unit)
    setThreshold(ing.lowStockThreshold != null ? String(ing.lowStockThreshold) : '')
    setFormOpen(true)
  }

  async function saveIngredient(e?: FormEvent): Promise<void> {
    if (e) e.preventDefault()
    if (!nameAr.trim() || !unit.trim()) throw new Error('يرجى إدخال اسم المادة الخام والوحدة')

    if (editingIng) {
      await updateIngredient(editingIng.id, {
        nameAr: nameAr.trim(),
        unit: unit.trim(),
        lowStockThreshold: threshold ? Number(threshold) : undefined
      }, user)
      setMessage('تم تعديل المادة الخام')
    } else {
      await createIngredient({
        nameAr: nameAr.trim(),
        unit: unit.trim(),
        lowStockThreshold: threshold ? Number(threshold) : undefined,
        active: true
      }, user)
      setMessage('تم إضافة المادة الخام')
    }
    await onRefresh()
  }

  return (
    <div className="tab-content">
      <div className="page-toolbar mb-16">
        <h2 className="card__title m-0">المواد الخام ({ingredients.length})</h2>
        <button type="button" className="btn btn--primary" onClick={openCreate}>+ إضافة مادة خام</button>
      </div>

      <p className="text-sm text-muted mb-12">
        المواد الخام تُستخدم في الوصفات وتُخصم من المخزون. يمكن بيعها مباشرة من الـ POS كمنتج من نوع "مادة خام".
      </p>

      <div className="card">
        {ingredients.length === 0 && <p className="report-empty">لا توجد مواد خام بعد</p>}
        {ingredients.length > 0 && (
          <table className="data-table">
            <thead>
              <tr><th>الاسم</th><th>الوحدة</th><th>حد التنبيه</th><th>الحالة</th><th>إجراءات</th></tr>
            </thead>
            <tbody>
              {ingredients.map((ing) => (
                <tr key={ing.id}>
                  <td>{ing.nameAr}</td>
                  <td>{ing.unit}</td>
                  <td>{ing.lowStockThreshold ?? '—'}</td>
                  <td>
                    <span style={{ color: ing.active ? 'var(--color-success)' : 'var(--color-muted)', fontWeight: 700, fontSize: '0.82rem' }}>
                      {ing.active ? 'مفعّل' : 'معطّل'}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions">
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => openEdit(ing)}><MdEdit /> تعديل</button>
                      <button type="button" className={`btn btn--sm ${ing.active ? 'btn--secondary' : 'btn--danger'}`} onClick={() => void updateIngredient(ing.id, { active: !ing.active }, user).then(onRefresh)}>{ing.active ? 'مفعّل' : 'معطّل'}</button>
                      <ConfirmDialog
                        open={itemToDelete === ing.id}
                        onCancel={() => setItemToDelete(null)}
                        onConfirm={async () => {
                          try {
                            await deleteIngredient(ing.id, user)
                            setMessage(`تم حذف "${ing.nameAr}"`)
                            setItemToDelete(null)
                            await onRefresh()
                          } catch (e) {
                            setMessage(e instanceof Error ? e.message : 'فشل الحذف')
                          }
                        }}
                        title="تأكيد الحذف"
                        message={`حذف مادة خام "${ing.nameAr}"؟`}
                        confirmLabel="حذف"
                        danger
                      />
                      <button type="button" className="btn btn--danger btn--sm" onClick={() => setItemToDelete(ing.id)}><MdDelete /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <FormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        entityName="مادة خام"
        isEdit={!!editingIng}
        onSubmit={saveIngredient}
        maxWidth={500}
      >
        <div className="settings-form-grid grid-cols-1">
          <FormField label="الاسم" required>
            <input 
              value={nameAr} 
              onChange={(e) => setNameAr(e.target.value)} 
              placeholder="مثال: طماطم" 
              autoFocus 
              required 
            />
          </FormField>
          <FormField label="الوحدة" required>
            <input 
              value={unit} 
              onChange={(e) => setUnit(e.target.value)} 
              placeholder="جرام / كيلو / لتر..." 
              required 
            />
          </FormField>
          <FormField label="حد التنبيه (اختياري)">
            <input 
              type="number" 
              min="0" 
              step="0.01" 
              value={threshold} 
              onChange={(e) => setThreshold(e.target.value)} 
              placeholder="تنبيه عند نقص الكمية" 
            />
          </FormField>
        </div>
      </FormModal>
    </div>
  )
}
