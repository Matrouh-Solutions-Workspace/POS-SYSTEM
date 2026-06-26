import React, { useState, FormEvent } from 'react'
import { ItemSize } from '@shared/types'
import { createSize, updateSize, deleteSize, reorderSizes } from '@renderer/features/menu/sizes-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { ConfirmDialog, FormModal, FormField } from '@renderer/components/ui'
import { MdArrowUpward, MdArrowDownward, MdEdit, MdDelete } from 'react-icons/md'
import { moveItem } from './items-types'

export function SizesTab({ sizes, onRefresh, setMessage }: {
  sizes: ItemSize[]
  onRefresh: () => Promise<void>
  setMessage: (m: string | null) => void
}): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [formOpen, setFormOpen] = useState(false)
  const [editingSize, setEditingSize] = useState<ItemSize | null>(null)
  const [name, setName] = useState('')
  const [itemToDelete, setItemToDelete] = useState<string | null>(null)
  const [savingOrder, setSavingOrder] = useState(false)

  function openCreate() {
    setEditingSize(null)
    setName('')
    setFormOpen(true)
  }

  function openEdit(s: ItemSize) {
    setEditingSize(s)
    setName(s.nameAr)
    setFormOpen(true)
  }

  async function saveSize(e?: FormEvent): Promise<void> {
    if (e) e.preventDefault()
    if (!name.trim()) throw new Error('يرجى إدخال اسم الحجم')

    if (editingSize) {
      await updateSize(editingSize.id, { nameAr: name.trim() }, user)
      setMessage('تم تعديل الحجم')
    } else {
      await createSize(name.trim(), sizes.length, user)
      setMessage('تم إضافة الحجم')
    }
    await onRefresh()
  }

  async function moveSize(idx: number, dir: -1 | 1): Promise<void> {
    const next = moveItem(sizes, idx, dir).map((s, i) => ({ ...s, sortOrder: i }))
    setSavingOrder(true)
    try { await reorderSizes(next.map((s) => ({ id: s.id, sortOrder: s.sortOrder }))) }
    finally { setSavingOrder(false); await onRefresh() }
  }

  return (
    <div className="tab-content">
      <div className="page-toolbar mb-16">
        <h2 className="card__title m-0">قائمة الأحجام ({sizes.length})</h2>
        <button type="button" className="btn btn--primary" onClick={openCreate}>+ إضافة حجم</button>
      </div>

      <p className="text-sm text-muted mb-12">
        تُستخدم الأحجام المحددة هنا (مثل: كبير، وسط، صغير) كخيارات عند إضافة الأصناف.
      </p>

      {savingOrder && <p className="form-message" role="status">جارٍ حفظ الترتيب...</p>}

      <div className="card">
        {sizes.length === 0 && <p className="report-empty">لا توجد أحجام. أضف أحجاماً لاستخدامها في الأصناف</p>}
        <ul className="category-list">
          {sizes.map((s, idx) => (
            <li key={s.id} className="category-list__item">
              <div className="sort-arrows">
                <button type="button" className="sort-arrow-btn" disabled={idx === 0} onClick={() => void moveSize(idx, -1)} aria-label="أعلى"><MdArrowUpward /></button>
                <button type="button" className="sort-arrow-btn" disabled={idx === sizes.length - 1} onClick={() => void moveSize(idx, 1)} aria-label="أسفل"><MdArrowDownward /></button>
              </div>
              
              <span className="flex-1">
                {s.nameAr}
                {!s.active && <em className="text-xs text-muted mr-6">(معطّل)</em>}
              </span>
              
              <div className="table-actions">
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => openEdit(s)}><MdEdit /> تعديل</button>
                <button type="button" className={`btn btn--sm ${s.active ? 'btn--secondary' : 'btn--danger'}`} onClick={() => void updateSize(s.id, { active: !s.active }, user).then(onRefresh)}>{s.active ? 'مفعّل' : 'معطّل'}</button>
                <ConfirmDialog
                  open={itemToDelete === s.id}
                  onCancel={() => setItemToDelete(null)}
                  onConfirm={async () => {
                    await deleteSize(s.id, user)
                    setMessage(`تم حذف الحجم "${s.nameAr}"`)
                    setItemToDelete(null)
                    await onRefresh()
                  }}
                  title="تأكيد الحذف"
                  message={`حذف الحجم "${s.nameAr}"؟`}
                  confirmLabel="حذف"
                  danger
                />
                <button type="button" className="btn btn--danger btn--sm" onClick={() => setItemToDelete(s.id)}><MdDelete /></button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <FormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        entityName="حجم"
        isEdit={!!editingSize}
        onSubmit={saveSize}
        maxWidth={400}
      >
        <div className="settings-form-grid grid-cols-1">
          <FormField label="اسم الحجم" required>
            <input 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
              placeholder="مثال: كبير" 
              autoFocus 
              required 
            />
          </FormField>
        </div>
      </FormModal>
    </div>
  )
}
