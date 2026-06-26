import React, { useState, FormEvent } from 'react'
import { ItemAddon } from '@shared/types'
import { createAddon, updateAddon, deleteAddon, reorderAddons } from '@renderer/features/menu/addons-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { ConfirmDialog, FormModal, FormField } from '@renderer/components/ui'
import { MdArrowUpward, MdArrowDownward, MdEdit, MdDelete } from 'react-icons/md'
import { moveItem } from './items-types'

export function AddonsTab({ addons, onRefresh, setMessage }: {
  addons: ItemAddon[]
  onRefresh: () => Promise<void>
  setMessage: (m: string | null) => void
}): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [formOpen, setFormOpen] = useState(false)
  const [editingAddon, setEditingAddon] = useState<ItemAddon | null>(null)
  
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  
  const [itemToDelete, setItemToDelete] = useState<string | null>(null)
  const [savingOrder, setSavingOrder] = useState(false)

  function openCreate() {
    setEditingAddon(null)
    setName('')
    setPrice('')
    setFormOpen(true)
  }

  function openEdit(a: ItemAddon) {
    setEditingAddon(a)
    setName(a.nameAr)
    setPrice(String(a.defaultPrice))
    setFormOpen(true)
  }

  async function saveAddon(e?: FormEvent): Promise<void> {
    if (e) e.preventDefault()
    if (!name.trim()) throw new Error('يرجى إدخال اسم الإضافة')

    if (editingAddon) {
      await updateAddon(editingAddon.id, { nameAr: name.trim(), defaultPrice: Number(price) || 0 }, user)
      setMessage('تم تعديل الإضافة')
    } else {
      await createAddon(name.trim(), Number(price) || 0, addons.length, user)
      setMessage('تم إضافة الإضافة')
    }
    await onRefresh()
  }

  async function moveAddon(idx: number, dir: -1 | 1): Promise<void> {
    const next = moveItem(addons, idx, dir).map((a, i) => ({ ...a, sortOrder: i }))
    setSavingOrder(true)
    try { await reorderAddons(next.map((a) => ({ id: a.id, sortOrder: a.sortOrder }))) }
    finally { setSavingOrder(false); await onRefresh() }
  }

  return (
    <div className="tab-content">
      <div className="page-toolbar mb-16">
        <h2 className="card__title m-0">قائمة الإضافات ({addons.length})</h2>
        <button type="button" className="btn btn--primary" onClick={openCreate}>+ إضافة مرفق</button>
      </div>

      <p className="text-sm text-muted mb-12">
        عرّف قائمة الإضافات المتاحة (جبنة إضافية، صوص، بطاطس…) وستظهر كخيارات عند إنشاء الأصناف.
      </p>

      {savingOrder && <p className="form-message" role="status">جارٍ حفظ الترتيب...</p>}

      <div className="card">
        {addons.length === 0 && <p className="report-empty">لا توجد إضافات بعد — أضف إضافات لتستخدمها في الأصناف</p>}
        {addons.length > 0 && (
          <table className="data-table">
            <thead>
              <tr><th>ترتيب</th><th>الإضافة</th><th>السعر الافتراضي</th><th>الحالة</th><th>إجراءات</th></tr>
            </thead>
            <tbody>
              {addons.map((a, idx) => (
                <tr key={a.id}>
                  <td>
                    <div className="sort-arrows">
                      <button type="button" className="sort-arrow-btn" disabled={idx === 0} onClick={() => void moveAddon(idx, -1)}><MdArrowUpward /></button>
                      <button type="button" className="sort-arrow-btn" disabled={idx === addons.length - 1} onClick={() => void moveAddon(idx, 1)}><MdArrowDownward /></button>
                    </div>
                  </td>
                  <td>{a.nameAr}</td>
                  <td>{a.defaultPrice.toFixed(2)}</td>
                  <td>
                    <span style={{ color: a.active ? 'var(--color-success)' : 'var(--color-muted)', fontWeight: 700, fontSize: '0.82rem' }}>
                      {a.active ? 'مفعّل' : 'معطّل'}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions">
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => openEdit(a)}><MdEdit /> تعديل</button>
                      <button type="button" className={`btn btn--sm ${a.active ? 'btn--secondary' : 'btn--danger'}`} onClick={() => void updateAddon(a.id, { active: !a.active }, user).then(onRefresh)}>{a.active ? 'مفعّل' : 'معطّل'}</button>
                      <ConfirmDialog
                        open={itemToDelete === a.id}
                        onCancel={() => setItemToDelete(null)}
                        onConfirm={async () => {
                          await deleteAddon(a.id, user)
                          setMessage(`تم حذف "${a.nameAr}"`)
                          setItemToDelete(null)
                          await onRefresh()
                        }}
                        title="تأكيد الحذف"
                        message={`حذف إضافة "${a.nameAr}"؟`}
                        confirmLabel="حذف"
                        danger
                      />
                      <button type="button" className="btn btn--danger btn--sm" onClick={() => setItemToDelete(a.id)}><MdDelete /></button>
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
        entityName="إضافة/مرفق"
        isEdit={!!editingAddon}
        onSubmit={saveAddon}
        maxWidth={480}
      >
        <div className="settings-form-grid grid-cols-1">
          <FormField label="اسم الإضافة" required>
            <input 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
              placeholder="مثال: جبنة إضافية" 
              autoFocus 
              required 
            />
          </FormField>
          <FormField label="السعر الافتراضي">
            <input 
              type="number" 
              min="0" 
              step="0.01" 
              value={price} 
              onChange={(e) => setPrice(e.target.value)} 
              placeholder="0.00" 
            />
          </FormField>
        </div>
      </FormModal>
    </div>
  )
}
