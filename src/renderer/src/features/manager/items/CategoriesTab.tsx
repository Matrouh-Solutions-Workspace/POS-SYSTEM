import React, { useEffect, useMemo, useState, FormEvent, type DragEvent } from 'react'
import { MenuCategory } from '@shared/types'
import { createCategory, updateCategory, deleteCategory, reorderCategories } from '@renderer/features/menu/menu-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { ConfirmDialog, FormModal, FormField } from '@renderer/components/ui'
import { MdArrowUpward, MdArrowDownward, MdEdit, MdDelete, MdDragIndicator } from 'react-icons/md'

const ROOT_PARENT_KEY = '__root__'

function parentScope(category: MenuCategory): string {
  return category.parentId ?? ROOT_PARENT_KEY
}

function replaceScopedOrder(
  categories: MenuCategory[],
  scope: string,
  orderedSiblings: MenuCategory[]
): MenuCategory[] {
  const byId = new Map(orderedSiblings.map((category) => [category.id, category]))
  const queue = [...orderedSiblings]

  return categories.map((category) => {
    if (parentScope(category) !== scope) return category
    return queue.shift() ?? byId.get(category.id) ?? category
  })
}

function buildVisibleCategories(categories: MenuCategory[]): MenuCategory[] {
  const childrenByParent = categories.reduce<Record<string, MenuCategory[]>>((acc, category) => {
    if (!category.parentId) return acc
    acc[category.parentId] = [...(acc[category.parentId] ?? []), category]
    return acc
  }, {})

  const rootCategories = categories.filter((category) => !category.parentId)
  const rootCategoryIds = new Set(rootCategories.map((category) => category.id))

  return rootCategories
    .flatMap((category) => [category, ...(childrenByParent[category.id] ?? [])])
    .concat(categories.filter((category) => category.parentId && !rootCategoryIds.has(category.parentId)))
}

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
  const [dragOverCategoryId, setDragOverCategoryId] = useState<string | null>(null)
  const [blockedDropCategoryId, setBlockedDropCategoryId] = useState<string | null>(null)
  const [draftCategories, setDraftCategories] = useState<MenuCategory[] | null>(null)

  const orderedCategories = draftCategories ?? categories
  const visibleCategories = useMemo(() => buildVisibleCategories(orderedCategories), [orderedCategories])

  useEffect(() => {
    if (savingOrder || draggingCategoryId) return
    setDraftCategories(null)
  }, [categories])

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

  function clearDragState(): void {
    setDraggingCategoryId(null)
    setDragOverCategoryId(null)
    setBlockedDropCategoryId(null)
  }

  function categoryById(categoryId: string): MenuCategory | undefined {
    return orderedCategories.find((item) => item.id === categoryId)
  }

  function getScopedSiblings(category: MenuCategory): MenuCategory[] {
    const scope = parentScope(category)
    return orderedCategories.filter((item) => parentScope(item) === scope)
  }

  function buildMovedCategories(categoryId: string, toIdx: number): MenuCategory[] | null {
    const category = categoryById(categoryId)
    if (!category) return null

    const scope = parentScope(category)
    const siblings = getScopedSiblings(category)
    const fromIdx = siblings.findIndex((item) => item.id === categoryId)
    if (fromIdx < 0 || toIdx < 0 || toIdx >= siblings.length || fromIdx === toIdx) return null

    const orderedSiblings = [...siblings]
    const [moved] = orderedSiblings.splice(fromIdx, 1)
    if (!moved) return null
    orderedSiblings.splice(toIdx, 0, moved)

    return replaceScopedOrder(orderedCategories, scope, orderedSiblings)
  }

  async function persistCategoryOrder(nextVisibleCategories: MenuCategory[]): Promise<void> {
    const next = nextVisibleCategories.map((c, i) => ({ ...c, sortOrder: i }))
    setDraftCategories(next)
    setSavingOrder(true)
    try { await reorderCategories(next.map((c) => ({ id: c.id, sortOrder: c.sortOrder }))) }
    catch (err) {
      setMessage(err instanceof Error ? err.message : 'تعذر حفظ ترتيب التصنيفات')
      setDraftCategories(null)
    }
    finally {
      setSavingOrder(false)
      clearDragState()
      await onRefresh()
    }
  }

  function canMoveCategory(category: MenuCategory, dir: -1 | 1): boolean {
    const siblings = getScopedSiblings(category)
    const idx = siblings.findIndex((item) => item.id === category.id)
    const targetIdx = idx + dir
    return idx >= 0 && targetIdx >= 0 && targetIdx < siblings.length
  }

  async function moveCat(categoryId: string, dir: -1 | 1): Promise<void> {
    if (savingOrder) return
    const category = categoryById(categoryId)
    if (!category) return

    const siblings = getScopedSiblings(category)
    const fromIdx = siblings.findIndex((item) => item.id === categoryId)
    const nextCategories = buildMovedCategories(categoryId, fromIdx + dir)
    if (!nextCategories) return

    await persistCategoryOrder(buildVisibleCategories(nextCategories))
  }

  async function dropCategory(targetId: string): Promise<void> {
    if (savingOrder) return
    if (!draggingCategoryId || draggingCategoryId === targetId) {
      clearDragState()
      return
    }
    const dragged = categoryById(draggingCategoryId)
    const target = categoryById(targetId)
    if (!dragged || !target) {
      clearDragState()
      return
    }
    if (parentScope(dragged) !== parentScope(target)) {
      setBlockedDropCategoryId(targetId)
      setMessage(dragged.parentId ? 'التصنيفات الفرعية تتحرك داخل نفس التصنيف الرئيسي فقط' : 'التصنيفات الرئيسية تتحرك مع الرئيسية فقط')
      return
    }

    const siblings = getScopedSiblings(dragged)
    const toIdx = siblings.findIndex((category) => category.id === targetId)
    const nextCategories = buildMovedCategories(draggingCategoryId, toIdx)
    if (!nextCategories) {
      clearDragState()
      return
    }

    await persistCategoryOrder(buildVisibleCategories(nextCategories))
  }

  function startCategoryDrag(event: DragEvent<HTMLSpanElement>, categoryId: string): void {
    if (savingOrder) {
      event.preventDefault()
      return
    }
    setDraftCategories(categories)
    setDraggingCategoryId(categoryId)
    setDragOverCategoryId(null)
    setBlockedDropCategoryId(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', categoryId)
  }

  function allowCategoryDrop(event: DragEvent<HTMLLIElement>, categoryId: string): void {
    if (!draggingCategoryId || draggingCategoryId === categoryId) return
    const dragged = categoryById(draggingCategoryId)
    const target = categoryById(categoryId)
    if (!dragged || !target) return
    if (parentScope(dragged) !== parentScope(target)) {
      setBlockedDropCategoryId(categoryId)
      setDragOverCategoryId(null)
      event.dataTransfer.dropEffect = 'none'
      return
    }
    event.preventDefault()
    setBlockedDropCategoryId(null)
    setDragOverCategoryId(categoryId)
    event.dataTransfer.dropEffect = 'move'
  }

  function handleCategoryDragLeave(event: DragEvent<HTMLLIElement>, categoryId: string): void {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
    setDragOverCategoryId((current) => (current === categoryId ? null : current))
    setBlockedDropCategoryId((current) => (current === categoryId ? null : current))
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
          {visibleCategories.map((c) => {
            const canMoveUp = canMoveCategory(c, -1)
            const canMoveDown = canMoveCategory(c, 1)

            return (
              <li
                key={c.id}
                className={[
                  'category-list__item draggable-row',
                  draggingCategoryId === c.id ? 'draggable-row--dragging' : '',
                  dragOverCategoryId === c.id ? 'draggable-row--drop-target' : '',
                  blockedDropCategoryId === c.id ? 'draggable-row--drop-blocked' : ''
                ].filter(Boolean).join(' ')}
                style={c.parentId ? { marginInlineStart: 28, borderInlineStart: '3px solid var(--color-border)', background: '#f8fafc' } : undefined}
                aria-grabbed={draggingCategoryId === c.id}
                onDragOver={(event) => allowCategoryDrop(event, c.id)}
                onDragLeave={(event) => handleCategoryDragLeave(event, c.id)}
                onDrop={(event) => { event.preventDefault(); void dropCategory(c.id) }}
                onDragEnd={clearDragState}
              >
                <span
                  className="drag-handle"
                  title="اسحب لتغيير الترتيب"
                  aria-hidden="true"
                  draggable={!savingOrder}
                  onDragStart={(event) => startCategoryDrag(event, c.id)}
                  onDragEnd={clearDragState}
                >
                  <MdDragIndicator />
                </span>
                <div className="sort-arrows">
                  <button type="button" className="sort-arrow-btn" disabled={savingOrder || !canMoveUp} onClick={() => void moveCat(c.id, -1)} aria-label="أعلى"><MdArrowUpward /></button>
                  <button type="button" className="sort-arrow-btn" disabled={savingOrder || !canMoveDown} onClick={() => void moveCat(c.id, 1)} aria-label="أسفل"><MdArrowDownward /></button>
                </div>

                <span className="category-list__text">
                  <span className="category-list__name">{c.nameAr}</span>
                  {(c.parentId || !c.active) && (
                    <span className="category-list__meta">
                      {c.parentId && (
                        <span>فرعي من {categories.find((p) => p.id === c.parentId)?.nameAr}</span>
                      )}
                      {!c.active && <span>معطّل</span>}
                    </span>
                  )}
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
