import React, { useState, FormEvent, type DragEvent } from 'react'
import { MenuCategory } from '@shared/types'
import { createCategory, updateCategory, deleteCategory, reorderCategories } from '@renderer/features/menu/menu-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { ConfirmDialog, FormModal, FormField } from '@renderer/components/ui'
import { MdArrowUpward, MdArrowDownward, MdEdit, MdDelete, MdDragIndicator } from 'react-icons/md'
import { moveItem } from './items-types'

export function CategoriesTab({ categories, onRefresh, setMessage }: {
  categories: MenuCategory[]
  onRefresh: () => Promise<void>
  setMessage: (m: string | null) => void
}): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  
  const [formOpen, setFormOpen] = useState(false)
  const [editingCat, setEditingCat] = useState<MenuCategory | null>(null)
  const [catName, setCatName] = useState('')
  const [catParentId, setCatParentId] = useState('')

  const [itemToDelete, setItemToDelete] = useState<string | null>(null)
  const [savingOrder, setSavingOrder] = useState(false)
  const [draggingCategoryId, setDraggingCategoryId] = useState<string | null>(null)

  const childCategoriesByParent = categories.reduce<Record<string, MenuCategory[]>>((acc, category) => {
    if (!category.parentId) return acc
    acc[category.parentId] = [...(acc[category.parentId] ?? []), category]
    return acc
  }, {})
  
  const rootCategoryIds = new Set(categories.filter((category) => !category.parentId).map((category) => category.id))
  
  const visibleCategories = categories.flatMap((category) => {
    if (category.parentId) return []
    return [category, ...(childCategoriesByParent[category.id] ?? [])]
  }).concat(categories.filter((category) => category.parentId && !rootCategoryIds.has(category.parentId)))

  function openCreate() {
    setEditingCat(null)
    setCatName('')
    setCatParentId('')
    setFormOpen(true)
  }

  function openEdit(c: MenuCategory) {
    setEditingCat(c)
    setCatName(c.nameAr)
    setCatParentId(c.parentId ?? '')
    setFormOpen(true)
  }

  async function saveCategory(e?: FormEvent): Promise<void> {
    if (e) e.preventDefault()
    if (!catName.trim()) throw new Error('يرجى إدخال اسم التصنيف')

    if (editingCat) {
      await updateCategory(editingCat.id, { nameAr: catName.trim(), parentId: catParentId || undefined }, user)
      setMessage('تم تعديل التصنيف')
    } else {
      await createCategory(catName.trim(), categories.length, catParentId || undefined, user)
      setMessage('تم إضافة التصنيف')
    }
    await onRefresh()
  }

  async function persistCategoryOrder(nextVisibleCategories: MenuCategory[]): Promise<void> {
    const next = nextVisibleCategories.map((c, i) => ({ ...c, sortOrder: i }))
    setSavingOrder(true)
    try { await reorderCategories(next.map((c) => ({ id: c.id, sortOrder: c.sortOrder }))) }
    finally {
      setSavingOrder(false)
      setDraggingCategoryId(null)
      await onRefresh()
    }
  }

  async function moveCat(idx: number, dir: -1 | 1): Promise<void> {
    await persistCategoryOrder(moveItem(visibleCategories, idx, dir))
  }

  async function dropCategory(targetId: string): Promise<void> {
    if (!draggingCategoryId || draggingCategoryId === targetId) return
    const fromIdx = visibleCategories.findIndex((category) => category.id === draggingCategoryId)
    const toIdx = visibleCategories.findIndex((category) => category.id === targetId)
    if (fromIdx < 0 || toIdx < 0) return

    const next = [...visibleCategories]
    const [dragged] = next.splice(fromIdx, 1)
    if (!dragged) return
    next.splice(toIdx, 0, dragged)
    await persistCategoryOrder(next)
  }

  function startCategoryDrag(event: DragEvent<HTMLLIElement>, categoryId: string): void {
    setDraggingCategoryId(categoryId)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', categoryId)
  }

  function allowCategoryDrop(event: DragEvent<HTMLLIElement>, categoryId: string): void {
    if (!draggingCategoryId || draggingCategoryId === categoryId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  return (
    <div className="tab-content">
      <div className="page-toolbar section-action-header mb-16">
        <h2 className="card__title m-0">التصنيفات ({categories.length})</h2>
        <button type="button" className="btn btn--primary" onClick={openCreate}>+ إضافة تصنيف</button>
      </div>

      {savingOrder && <p className="form-message" role="status">جارٍ حفظ الترتيب...</p>}

      <div className="card">
        {categories.length === 0 && <p className="report-empty">لا توجد تصنيفات بعد</p>}
        <ul className="category-list">
          {visibleCategories.map((c, idx) => {
            return (
              <li
                key={c.id}
                className={`category-list__item draggable-row${draggingCategoryId === c.id ? ' draggable-row--dragging' : ''}`}
                style={c.parentId ? { marginInlineStart: 28, borderInlineStart: '3px solid var(--color-border)', background: '#f8fafc' } : undefined}
                draggable={!savingOrder}
                aria-grabbed={draggingCategoryId === c.id}
                onDragStart={(event) => startCategoryDrag(event, c.id)}
                onDragOver={(event) => allowCategoryDrop(event, c.id)}
                onDrop={(event) => { event.preventDefault(); void dropCategory(c.id) }}
                onDragEnd={() => setDraggingCategoryId(null)}
              >
                <span className="drag-handle" title="اسحب لتغيير الترتيب" aria-hidden="true"><MdDragIndicator /></span>
                <div className="sort-arrows">
                  <button type="button" className="sort-arrow-btn" disabled={idx === 0} onClick={() => void moveCat(idx, -1)} aria-label="أعلى"><MdArrowUpward /></button>
                  <button type="button" className="sort-arrow-btn" disabled={idx === visibleCategories.length - 1} onClick={() => void moveCat(idx, 1)} aria-label="أسفل"><MdArrowDownward /></button>
                </div>

                <span className="flex-1">
                  {c.nameAr}
                  {c.parentId && <em className="text-xs text-muted mr-6">فرعي من {categories.find((p) => p.id === c.parentId)?.nameAr}</em>}
                  {!c.active && <em className="text-xs text-muted mr-6">(معطّل)</em>}
                </span>

                <div className="table-actions">
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => openEdit(c)}><MdEdit /> تعديل</button>
                  <button type="button" className={`btn btn--sm ${c.active ? 'btn--secondary' : 'btn--danger'}`} onClick={() => void updateCategory(c.id, { active: !c.active }, user).then(onRefresh)}>{c.active ? 'مفعّل' : 'معطّل'}</button>
                  <ConfirmDialog
                    open={itemToDelete === c.id}
                    onCancel={() => setItemToDelete(null)}
                    onConfirm={async () => {
                      await deleteCategory(c.id, user)
                      setMessage(`تم حذف "${c.nameAr}"`)
                      setItemToDelete(null)
                      await onRefresh()
                    }}
                    title="تأكيد الحذف"
                    message={`حذف تصنيف "${c.nameAr}"؟`}
                    confirmLabel="حذف"
                    danger
                  />
                  <button type="button" className="btn btn--danger btn--sm" onClick={() => setItemToDelete(c.id)}><MdDelete /></button>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <FormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        entityName="تصنيف"
        isEdit={!!editingCat}
        onSubmit={saveCategory}
        maxWidth={480}
      >
        <div className="settings-form-grid grid-cols-1">
          <FormField label="اسم التصنيف" required>
            <input 
              value={catName} 
              onChange={(e) => setCatName(e.target.value)} 
              placeholder="مثال: مشروبات" 
              autoFocus 
              required 
            />
          </FormField>
          <FormField label="مجموعة أعلى">
            <select value={catParentId} onChange={(e) => setCatParentId(e.target.value)}>
              <option value="">رئيسية</option>
              {categories
                .filter((c) => !c.parentId && c.id !== editingCat?.id)
                .map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)
              }
            </select>
          </FormField>
        </div>
      </FormModal>
    </div>
  )
}
