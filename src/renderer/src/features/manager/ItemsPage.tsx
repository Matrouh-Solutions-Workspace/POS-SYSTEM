/**
 * أصناف — unified items page
 * Tabs: الأصناف | التصنيفات | الأحجام | الإضافات | المواد الخام
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type {
  MenuCategory,
  MenuItem,
  MenuItemType,
  ProductType,
  MenuItemAttachment,
  MenuItemSizeOption,
  RecipeLine,
  WeightedPriceOption,
  Ingredient,
  ItemSize,
  ItemAddon,
  KitchenPrinter
} from '@shared/types'
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listMenuItems,
  updateMenuItem,
  createMenuItemWithRecipe,
  getRecipe,
  updateRecipe,
  deleteMenuItem,
  reorderCategories,
  reorderMenuItems
} from '@renderer/features/menu/menu-service'
import {
  listIngredients,
  createIngredient,
  updateIngredient,
  deleteIngredient
} from '@renderer/features/inventory/inventory-service'
import { listSizes, createSize, updateSize, deleteSize, reorderSizes } from '@renderer/features/menu/sizes-service'
import { listAddons, createAddon, updateAddon, deleteAddon, reorderAddons } from '@renderer/features/menu/addons-service'
import { listKitchenPrinters } from '@renderer/features/printers/printer-service'
import { ConfirmDialog, FormModal, FormField } from '@renderer/components/ui'
import { CategoriesTab } from './items/CategoriesTab'
import { SizesTab } from './items/SizesTab'
import { AddonsTab } from './items/AddonsTab'
import { RawMaterialsTab } from './items/RawMaterialsTab'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import {
  MdArrowUpward, MdArrowDownward, MdEdit, MdCheck,
  MdClose, MdMenuBook, MdStraighten, MdAddBox,
  MdInventory2, MdPrint, MdDelete
} from 'react-icons/md'
import { usePageState } from '@renderer/features/tabs/page-state-store'

// ── helpers ────────────────────────────────────────────────────────────────

function moveItem<T>(arr: T[], idx: number, dir: -1 | 1): T[] {
  const next = [...arr]
  const target = idx + dir
  if (target < 0 || target >= next.length) return next
  ;[next[idx], next[target]] = [next[target]!, next[idx]!]
  return next
}

// ── Form sub-types ─────────────────────────────────────────────────────────

type WeightedPriceOptionForm = { id: string; label: string; weightGrams: string; price: string }
type SizeOptionForm           = { id: string; masterSizeId: string; labelAr: string; price: string }
type AttachmentForm           = { id: string; masterAddonId: string; nameAr: string; price: string }
type RecipeLineForm           = { ingredientId: string; quantity: string; unit: string }

type ItemEditState = {
  id: string; nameAr: string; price: string; categoryId: string
  itemType: MenuItemType; productType: ProductType; linkedIngredientId: string
  sizeOptions: SizeOptionForm[]; attachments: AttachmentForm[]
  isWeighted: boolean; weightedPriceOptions: WeightedPriceOptionForm[]
  allowCustomWeight: boolean; customWeightUnitPrice: string; active: boolean
  kitchenPrinterIds: string[]
  imageUrl: string
}

async function optimizeProductImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('اختر ملف صورة صالح')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('تعذر قراءة الصورة'))
    reader.readAsDataURL(file)
  })
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const value = new Image()
    value.onload = () => resolve(value)
    value.onerror = () => reject(new Error('تعذر معالجة الصورة'))
    value.src = dataUrl
  })
  const scale = Math.min(1, 640 / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/webp', 0.82)
}

function newWeightedOption(kiloPreset = false): WeightedPriceOptionForm {
  return { id: crypto.randomUUID(), label: kiloPreset ? '1 كجم' : '', weightGrams: kiloPreset ? '1000' : '', price: '' }
}
function newSizeOption(): SizeOptionForm  { return { id: crypto.randomUUID(), masterSizeId: '', labelAr: '', price: '' } }
function newAttachment(): AttachmentForm  { return { id: crypto.randomUUID(), masterAddonId: '', nameAr: '', price: '' } }

function toWeightedOptionForm(o: WeightedPriceOption): WeightedPriceOptionForm {
  return { id: o.id, label: o.label, weightGrams: String(Math.round(o.weightKg * 1000)), price: String(o.price) }
}
function toSizeOptionForm(o: MenuItemSizeOption): SizeOptionForm {
  return { id: o.id, masterSizeId: o.masterSizeId ?? '', labelAr: o.labelAr, price: String(o.price) }
}
function toAttachmentForm(o: MenuItemAttachment): AttachmentForm {
  return { id: o.id, masterAddonId: o.masterAddonId ?? '', nameAr: o.nameAr, price: String(o.price) }
}
function normalizeWeightedOptions(opts: WeightedPriceOptionForm[]): WeightedPriceOption[] {
  return opts
    .map((o) => ({ id: o.id || crypto.randomUUID(), label: o.label.trim(), weightKg: Number(o.weightGrams) / 1000, price: Number(o.price) }))
    .filter((o) => o.label && o.weightKg > 0 && o.price >= 0)
}
function normalizeSizeOptions(opts: SizeOptionForm[], sizes: ItemSize[]): MenuItemSizeOption[] {
  const sizeById = new Map(sizes.map((s) => [s.id, s]))
  return opts
    .map((o) => {
      const master = o.masterSizeId ? sizeById.get(o.masterSizeId) : undefined
      return {
        id: o.id || crypto.randomUUID(),
        masterSizeId: master?.id,
        labelAr: master?.nameAr ?? '',
        price: Number(o.price)
      }
    })
    .filter((o) => o.masterSizeId && o.labelAr && o.price >= 0)
}
function normalizeAttachments(opts: AttachmentForm[], addons: ItemAddon[]): MenuItemAttachment[] {
  const addonById = new Map(addons.map((a) => [a.id, a]))
  return opts
    .map((o) => {
      const master = o.masterAddonId ? addonById.get(o.masterAddonId) : undefined
      return {
        id: o.id || crypto.randomUUID(),
        masterAddonId: master?.id,
        nameAr: master?.nameAr ?? '',
        price: Number(o.price)
      }
    })
    .filter((o) => o.masterAddonId && o.nameAr && o.price >= 0)
}


// ── ItemsTab ────────────────────────────────────────────────────────────────

export type ItemFormState = {
  categoryId: string
  nameAr: string
  price: string
  itemType: MenuItemType
  productType: ProductType
  linkedIngredientId: string
  sizeOptions: SizeOptionForm[]
  attachments: AttachmentForm[]
  isWeighted: boolean
  weightedPriceOptions: WeightedPriceOptionForm[]
  allowCustomWeight: boolean
  customWeightUnitPrice: string
  kitchenPrinterIds: string[]
  lines: RecipeLineForm[]
  imageUrl: string
}

export const defaultItemForm: ItemFormState = {
  categoryId: '',
  nameAr: '',
  price: '',
  itemType: 'product',
  productType: 'recipe',
  linkedIngredientId: '',
  sizeOptions: [],
  attachments: [],
  isWeighted: false,
  weightedPriceOptions: [{ id: 'default-weighted', label: '1 كجم', weightGrams: '1000', price: '' }],
  allowCustomWeight: false,
  customWeightUnitPrice: '',
  kitchenPrinterIds: [],
  imageUrl: '',
  lines: [{ ingredientId: '', quantity: '', unit: 'جرام' }]
}

function cloneItemFormForRepeat(form: ItemFormState): ItemFormState {
  return {
    ...form,
    sizeOptions: form.sizeOptions.map((option) => ({ ...option, id: crypto.randomUUID() })),
    attachments: form.attachments.map((attachment) => ({ ...attachment, id: crypto.randomUUID() })),
    weightedPriceOptions: form.weightedPriceOptions.map((option) => ({ ...option, id: crypto.randomUUID() })),
    lines: form.lines.map((line) => ({ ...line }))
  }
}

// labels for itemType + productType
const ITEM_TYPE_LABELS: Record<MenuItemType, string> = {
  product: 'منتج',
  raw_material: 'مادة خام',
  service: 'خدمة'
}
const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  recipe: 'وصفة (يُحضَّر لحظة البيع)',
  ready_made: 'جاهز (له مخزون)',
  manufactured: 'مصنوع داخلياً (له مخزون)',
  no_inventory: 'جاهز (بدون مخزون)'
}

/** Whether this product type should show recipe lines (ingredient deduction) */
function needsRecipe(itemType: MenuItemType, productType: ProductType): boolean {
  if (itemType === 'service') return false
  if (itemType === 'raw_material') return false
  return productType === 'recipe'
}

function needsLinkedStock(itemType: MenuItemType, productType: ProductType): boolean {
  if (itemType === 'raw_material') return true
  if (itemType !== 'product') return false
  return productType === 'ready_made' || productType === 'manufactured'
}

function ItemsTab({ categories, items, ingredients, sizes, addons, printers, onRefresh, setMessage, itemForm, setItemForm, formRef }: {
  categories: MenuCategory[]
  items: MenuItem[]
  ingredients: Ingredient[]
  sizes: ItemSize[]
  addons: ItemAddon[]
  printers: KitchenPrinter[]
  onRefresh: () => Promise<void>
  setMessage: (m: string | null) => void
  itemForm: ItemFormState
  setItemForm: React.Dispatch<React.SetStateAction<ItemFormState>>
  formRef: React.RefObject<HTMLFormElement | null>
}): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [editingItem, setEditingItem] = useState<ItemEditState | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null)
  const [recipeLines, setRecipeLines] = useState<RecipeLine[]>([])
  const [itemToDelete, setItemToDelete] = useState<string | null>(null)
  const [savingOrder, setSavingOrder] = useState(false)

  function validateWeightedPricing(options: WeightedPriceOption[], allowCustom: boolean, customPrice: string): boolean {
    if (options.length === 0) { setMessage('أضف سعر ميزان واحد على الأقل'); return false }
    if (allowCustom && Number(customPrice) <= 0) { setMessage('حدد سعر الكيلو للوزن المخصص'); return false }
    return true
  }

  async function addItem(e?: FormEvent): Promise<void | boolean> {
    if (e) e.preventDefault()
    setMessage(null)
    const submitter = e ? (e.nativeEvent as Event & { submitter?: HTMLButtonElement | null }).submitter : null
    const shouldRepeat = submitter?.value === 'repeat'
    if (!itemForm.categoryId) { setMessage('اختر التصنيف أولاً'); return }
    const recipeLines: RecipeLine[] = needsRecipe(itemForm.itemType, itemForm.productType)
      ? itemForm.lines.filter((l) => l.ingredientId && l.quantity).map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity), unit: l.unit }))
      : []
    const weightedOpts = normalizeWeightedOptions(itemForm.weightedPriceOptions)
    const sizeOpts = normalizeSizeOptions(itemForm.sizeOptions, activeSizes)
    const attachOpts = normalizeAttachments(itemForm.attachments, activeAddons)
    if (itemForm.isWeighted && !validateWeightedPricing(weightedOpts, itemForm.allowCustomWeight, itemForm.customWeightUnitPrice)) return
    try {
      await createMenuItemWithRecipe({
        categoryId: itemForm.categoryId,
        nameAr: itemForm.nameAr.trim(),
        price: itemForm.isWeighted
          ? (itemForm.allowCustomWeight && Number(itemForm.customWeightUnitPrice) > 0
              ? Number(itemForm.customWeightUnitPrice)
              : (weightedOpts[0] ? weightedOpts[0].price / weightedOpts[0].weightKg : 0))
          : Number(itemForm.price),
        itemType: itemForm.itemType,
        productType: itemForm.itemType === 'product' ? itemForm.productType : undefined,
        linkedIngredientId: needsLinkedStock(itemForm.itemType, itemForm.productType)
          ? (itemForm.linkedIngredientId || undefined)
          : undefined,
        sizeOptions: itemForm.isWeighted ? [] : sizeOpts,
        attachments: attachOpts,
        isWeighted: itemForm.isWeighted,
        weightedPriceOptions: weightedOpts,
        allowCustomWeight: itemForm.isWeighted ? itemForm.allowCustomWeight : undefined,
        customWeightUnitPrice: itemForm.isWeighted && itemForm.allowCustomWeight ? Number(itemForm.customWeightUnitPrice) : undefined,
        kitchenPrinterIds: itemForm.kitchenPrinterIds,
        imageUrl: itemForm.imageUrl || undefined,
        lines: recipeLines,
        sortOrder: items.length,
        actor: user
      })
      setItemForm((f) => (
        shouldRepeat
          ? cloneItemFormForRepeat(f)
          : { ...defaultItemForm, categoryId: f.categoryId, weightedPriceOptions: [newWeightedOption(true)] }
      ))
      if (!shouldRepeat) setShowCreateModal(false)
      setMessage(shouldRepeat ? 'تم حفظ الصنف مع الإبقاء على البيانات' : 'تم حفظ الصنف')
      await onRefresh()
      return shouldRepeat ? false : undefined
    } catch (err) { setMessage(err instanceof Error ? err.message : 'فشل') }
  }

  async function saveItemEdit(): Promise<void> {
    if (!editingItem) return
    const weightedOpts = normalizeWeightedOptions(editingItem.weightedPriceOptions)
    const sizeOpts = normalizeSizeOptions(editingItem.sizeOptions, activeSizes)
    const attachOpts = normalizeAttachments(editingItem.attachments, activeAddons)
    if (editingItem.isWeighted && !validateWeightedPricing(weightedOpts, editingItem.allowCustomWeight, editingItem.customWeightUnitPrice)) return
    await updateMenuItem(editingItem.id, {
      nameAr: editingItem.nameAr.trim(),
      price: editingItem.isWeighted
        ? (editingItem.allowCustomWeight && Number(editingItem.customWeightUnitPrice) > 0
            ? Number(editingItem.customWeightUnitPrice)
            : (weightedOpts[0] ? weightedOpts[0].price / weightedOpts[0].weightKg : 0))
        : Number(editingItem.price),
      categoryId: editingItem.categoryId,
      itemType: editingItem.itemType,
      productType: editingItem.itemType === 'product' ? editingItem.productType : undefined,
      linkedIngredientId: needsLinkedStock(editingItem.itemType, editingItem.productType)
        ? (editingItem.linkedIngredientId || undefined)
        : undefined,
      sizeOptions: editingItem.isWeighted ? [] : sizeOpts,
      attachments: attachOpts,
      isWeighted: editingItem.isWeighted,
      weightedPriceOptions: editingItem.isWeighted ? weightedOpts : [],
      allowCustomWeight: editingItem.isWeighted ? editingItem.allowCustomWeight : false,
      customWeightUnitPrice: editingItem.isWeighted && editingItem.allowCustomWeight ? Number(editingItem.customWeightUnitPrice) : undefined,
      kitchenPrinterIds: editingItem.kitchenPrinterIds,
      imageUrl: editingItem.imageUrl || undefined,
      active: editingItem.active
    }, user)
    setEditingItem(null)
    setMessage('تم تعديل الصنف')
    await onRefresh()
  }

  async function moveMenuItem(idx: number, dir: -1 | 1): Promise<void> {
    const next = moveItem(items, idx, dir).map((it, i) => ({ ...it, sortOrder: i }))
    setSavingOrder(true)
    try { await reorderMenuItems(next.map((it) => ({ id: it.id, sortOrder: it.sortOrder }))) }
    finally { setSavingOrder(false); await onRefresh() }
  }

  async function openRecipe(item: MenuItem): Promise<void> {
    const recipe = await getRecipe(item.recipeId)
    if (recipe) { setEditingRecipeId(item.recipeId); setRecipeLines(recipe.lines) }
  }

  async function saveRecipe(): Promise<void> {
    if (!editingRecipeId) return
    await updateRecipe(editingRecipeId, recipeLines, undefined, user)
    setEditingRecipeId(null)
    setMessage('تم تعديل الوصفة')
  }

  function startEditItem(item: MenuItem): void {
    setEditingItem({
      id: item.id,
      nameAr: item.nameAr,
      price: String(item.price),
      categoryId: item.categoryId,
      itemType: item.itemType ?? 'product',
      productType: item.productType ?? 'recipe',
      linkedIngredientId: item.linkedIngredientId ?? '',
      sizeOptions: (item.sizeOptions ?? []).map(toSizeOptionForm),
      attachments: (item.attachments ?? []).map(toAttachmentForm),
      isWeighted: !!item.isWeighted,
      weightedPriceOptions: (item.weightedPriceOptions ?? []).map(toWeightedOptionForm),
      allowCustomWeight: !!item.allowCustomWeight,
      customWeightUnitPrice: item.customWeightUnitPrice != null ? String(item.customWeightUnitPrice) : '',
      kitchenPrinterIds: item.kitchenPrinterIds ?? [],
      imageUrl: item.imageUrl ?? '',
      active: item.active
    })
  }

  // Helper: pick a size from master list → fill labelAr automatically
  function handleSizeSelect(idx: number, masterSizeId: string, isForm: true): void
  function handleSizeSelect(idx: number, masterSizeId: string, isForm: false): void
  function handleSizeSelect(idx: number, masterSizeId: string, isForm: boolean): void {
    const master = sizes.find((s) => s.id === masterSizeId)
    if (isForm) {
      setItemForm((f) => {
        const s = [...f.sizeOptions]
        s[idx] = { ...s[idx]!, masterSizeId, labelAr: master?.nameAr ?? s[idx]!.labelAr }
        return { ...f, sizeOptions: s }
      })
    } else {
      setEditingItem((prev) => {
        if (!prev) return prev
        const s = [...prev.sizeOptions]
        s[idx] = { ...s[idx]!, masterSizeId, labelAr: master?.nameAr ?? s[idx]!.labelAr }
        return { ...prev, sizeOptions: s }
      })
    }
  }

  // Helper: pick an addon from master list → fill nameAr + price automatically
  function handleAddonSelect(idx: number, masterAddonId: string, isForm: boolean): void {
    const master = addons.find((a) => a.id === masterAddonId)
    if (isForm) {
      setItemForm((f) => {
        const a = [...f.attachments]
        a[idx] = { ...a[idx]!, masterAddonId, nameAr: master?.nameAr ?? a[idx]!.nameAr, price: master ? String(master.defaultPrice) : a[idx]!.price }
        return { ...f, attachments: a }
      })
    } else {
      setEditingItem((prev) => {
        if (!prev) return prev
        const a = [...prev.attachments]
        a[idx] = { ...a[idx]!, masterAddonId, nameAr: master?.nameAr ?? a[idx]!.nameAr, price: master ? String(master.defaultPrice) : a[idx]!.price }
        return { ...prev, attachments: a }
      })
    }
  }

  const activeSizes = sizes.filter((s) => s.active)
  const activeAddons = addons.filter((a) => a.active)
  const activePrinters = printers.filter((printer) => printer.active)

  function renderImageField(imageUrl: string, isForm: boolean): React.ReactElement {
    const update = (value: string): void => {
      if (isForm) setItemForm((form) => ({ ...form, imageUrl: value }))
      else setEditingItem((item) => item ? { ...item, imageUrl: value } : item)
    }
    return (
      <div className="product-image-editor">
        <div className="product-image-editor__preview">
          {imageUrl
            ? <img src={imageUrl} alt="معاينة صورة الصنف" />
            : <span>لا توجد صورة</span>}
        </div>
        <label className="field">
          <span>صورة الصنف</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              void optimizeProductImage(file)
                .then(update)
                .catch((error) => setMessage(error instanceof Error ? error.message : 'تعذر معالجة الصورة'))
              event.target.value = ''
            }}
          />
        </label>
        {imageUrl && <button type="button" className="btn btn--danger btn--sm" onClick={() => update('')}>حذف الصورة</button>}
      </div>
    )
  }

  function renderPrinterSection(selectedIds: string[], isForm: boolean): React.ReactElement {
    return (
      <div className="weighted-pricing-editor">
        <h3><MdPrint style={{ verticalAlign: 'middle', marginLeft: 4 }} />طابعات التجهيز</h3>
        {activePrinters.length === 0 && (
          <p style={{ fontSize: '0.82rem', color: 'var(--color-muted)', margin: '0 0 8px' }}>
            أضف طابعات التجهيز من الإعدادات أولا.
          </p>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          {activePrinters.map((printer) => (
            <label key={printer.id} className="field--checkbox" style={{ border: '1px solid var(--color-border-light)', padding: 8, borderRadius: 4 }}>
              <input
                type="checkbox"
                checked={selectedIds.includes(printer.id)}
                onChange={(e) => {
                  const checked = e.target.checked
                  const next = checked
                    ? [...selectedIds, printer.id]
                    : selectedIds.filter((id) => id !== printer.id)
                  if (isForm) setItemForm((f) => ({ ...f, kitchenPrinterIds: next }))
                  else setEditingItem((prev) => prev ? { ...prev, kitchenPrinterIds: next } : prev)
                }}
              />
              <span>{printer.name}</span>
            </label>
          ))}
        </div>
      </div>
    )
  }

  // ── Render size options section (reused in add form + edit inline) ────────
  function renderSizeSection(
    sizeOpts: SizeOptionForm[],
    isWeighted: boolean,
    isForm: boolean
  ): React.ReactElement | null {
    if (isWeighted) return null
    return (
      <div className="weighted-pricing-editor">
        <h3>أحجام</h3>
        {activeSizes.length === 0 && (
          <p style={{ fontSize: '0.82rem', color: 'var(--color-muted)', margin: '0 0 8px' }}>
            أضف أحجاماً من تبويب الأحجام أولاً.
          </p>
        )}
        {sizeOpts.map((o, idx) => (
          <div key={o.id} className="weighted-pricing-row">
            <select
              value={o.masterSizeId}
              onChange={(e) => handleSizeSelect(idx, e.target.value, isForm as true)}
              style={{ minWidth: 140 }}
            >
              <option value="">اختر الحجم...</option>
              {activeSizes.map((s) => <option key={s.id} value={s.id}>{s.nameAr}</option>)}
            </select>
            <input
              value={o.masterSizeId ? (activeSizes.find((s) => s.id === o.masterSizeId)?.nameAr ?? o.labelAr) : ''}
              readOnly
              placeholder="اسم الحجم"
            />
            <input
              type="number" min="0" step="0.01"
              value={o.price}
              onChange={(e) => {
                if (isForm) setItemForm((f) => { const s=[...f.sizeOptions]; s[idx]={...s[idx]!,price:e.target.value}; return {...f,sizeOptions:s} })
                else setEditingItem((p) => p ? { ...p, sizeOptions: p.sizeOptions.map((s,i)=>i===idx?{...s,price:e.target.value}:s) } : p)
              }}
              placeholder="السعر"
            />
            <button
              type="button" className="btn btn--danger btn--sm"
              onClick={() => {
                if (isForm) setItemForm((f) => ({ ...f, sizeOptions: f.sizeOptions.filter((_,i)=>i!==idx) }))
                else setEditingItem((p) => p ? { ...p, sizeOptions: p.sizeOptions.filter((_,i)=>i!==idx) } : p)
              }}
            ><MdClose /></button>
          </div>
        ))}
        <button
          type="button" className="btn btn--secondary btn--sm"
          disabled={activeSizes.length === 0}
          onClick={() => {
            if (isForm) setItemForm((f) => ({ ...f, sizeOptions: [...f.sizeOptions, newSizeOption()] }))
            else setEditingItem((p) => p ? { ...p, sizeOptions: [...p.sizeOptions, newSizeOption()] } : p)
          }}
        >+ حجم</button>
      </div>
    )
  }

  // ── Render attachments section ─────────────────────────────────────────────
  function renderAttachmentsSection(
    attOpts: AttachmentForm[],
    isForm: boolean
  ): React.ReactElement {
    return (
      <div className="weighted-pricing-editor">
        <h3>مرفقات</h3>
        {activeAddons.length === 0 && (
          <p style={{ fontSize: '0.82rem', color: 'var(--color-muted)', margin: '0 0 8px' }}>
            أضف مرفقات من تبويب الإضافات أولاً.
          </p>
        )}
        {attOpts.map((o, idx) => (
          <div key={o.id} className="weighted-pricing-row">
            <select
              value={o.masterAddonId}
              onChange={(e) => handleAddonSelect(idx, e.target.value, isForm)}
              style={{ minWidth: 160 }}
            >
              <option value="">اختر المرفق...</option>
              {activeAddons.map((a) => <option key={a.id} value={a.id}>{a.nameAr}</option>)}
            </select>
            <input
              value={o.masterAddonId ? (activeAddons.find((a) => a.id === o.masterAddonId)?.nameAr ?? o.nameAr) : ''}
              readOnly
              placeholder="اسم المرفق"
            />
            <input
              type="number" min="0" step="0.01"
              value={o.price}
              onChange={(e) => {
                if (isForm) setItemForm((f) => { const a=[...f.attachments]; a[idx]={...a[idx]!,price:e.target.value}; return {...f,attachments:a} })
                else setEditingItem((p) => p ? { ...p, attachments: p.attachments.map((a,i)=>i===idx?{...a,price:e.target.value}:a) } : p)
              }}
              placeholder="السعر"
            />
            <button
              type="button" className="btn btn--danger btn--sm"
              onClick={() => {
                if (isForm) setItemForm((f) => ({ ...f, attachments: f.attachments.filter((_,i)=>i!==idx) }))
                else setEditingItem((p) => p ? { ...p, attachments: p.attachments.filter((_,i)=>i!==idx) } : p)
              }}
            ><MdClose /></button>
          </div>
        ))}
        <button
          type="button" className="btn btn--secondary btn--sm"
          disabled={activeAddons.length === 0}
          onClick={() => {
            if (isForm) setItemForm((f) => ({ ...f, attachments: [...f.attachments, newAttachment()] }))
            else setEditingItem((p) => p ? { ...p, attachments: [...p.attachments, newAttachment()] } : p)
          }}
        >+ مرفق</button>
      </div>
    )
  }

  const showRecipeSection = needsRecipe(itemForm.itemType, itemForm.productType)
  const showEditRecipeSection = editingItem ? needsRecipe(editingItem.itemType, editingItem.productType) : false

  return (
    <div className="tab-content">
      {savingOrder && <p className="form-message" role="status">جارٍ حفظ الترتيب...</p>}

      <CategoriesTab categories={categories} onRefresh={onRefresh} setMessage={setMessage} />

      <div className="card">
        <div className="page-toolbar" style={{ justifyContent: 'space-between' }}>
          <h2 className="card__title m-0">الأصناف</h2>
          <button type="button" className="btn btn--primary" onClick={() => setShowCreateModal(true)}>+ إضافة صنف</button>
        </div>
      </div>

      <FormModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        entityName="صنف"
        onSubmit={addItem}
        maxWidth={980}
        extraFooterButtons={
          <button type="submit" form="form-modal-form" name="action" value="repeat" className="btn btn--secondary" disabled={!itemForm.nameAr}>
            حفظ وإضافة المزيد
          </button>
        }
      >
          <div className="settings-form-grid">
            <label className="field">
              <span>التصنيف</span>
              <select value={itemForm.categoryId} onChange={(e) => setItemForm((f) => ({ ...f, categoryId: e.target.value }))} required>
                <option value="">اختر...</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
              </select>
            </label>
            <label className="field">
              <span>اسم الصنف</span>
              <input value={itemForm.nameAr} onChange={(e) => setItemForm((f) => ({ ...f, nameAr: e.target.value }))} required />
            </label>
            <label className="field">
              <span>نوع الصنف</span>
              <select
                value={itemForm.itemType}
                onChange={(e) => setItemForm((f) => ({ ...f, itemType: e.target.value as MenuItemType, productType: 'recipe' }))}
              >
                {(Object.entries(ITEM_TYPE_LABELS) as [MenuItemType, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            {itemForm.itemType === 'product' && (
              <label className="field">
                <span>نوع المنتج</span>
                <select
                  value={itemForm.productType}
                  onChange={(e) => setItemForm((f) => ({ ...f, productType: e.target.value as ProductType }))}
                >
                  {(Object.entries(PRODUCT_TYPE_LABELS) as [ProductType, string][]).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </label>
            )}
            {needsLinkedStock(itemForm.itemType, itemForm.productType) && (
              <label className="field">
                <span>رصيد المخزون المرتبط</span>
                <select value={itemForm.linkedIngredientId} onChange={(e) => setItemForm((f) => ({ ...f, linkedIngredientId: e.target.value }))}>
                  <option value="">بدون ربط</option>
                  {ingredients.filter((i) => i.active).map((i) => <option key={i.id} value={i.id}>{i.nameAr} ({i.unit})</option>)}
                </select>
              </label>
            )}
            {!itemForm.isWeighted && (
              <label className="field">
                <span>السعر</span>
                <input type="number" min="0" step="0.01" value={itemForm.price} onChange={(e) => setItemForm((f) => ({ ...f, price: e.target.value }))} required={!itemForm.isWeighted} />
              </label>
            )}
            {itemForm.itemType === 'product' && (
              <label className="field field--checkbox settings-form-grid__full">
                <input type="checkbox" checked={itemForm.isWeighted} onChange={(e) => setItemForm((f) => ({ ...f, isWeighted: e.target.checked, weightedPriceOptions: e.target.checked && f.weightedPriceOptions.length === 0 ? [newWeightedOption(true)] : f.weightedPriceOptions }))} />
                <span>منتج ميزان (الوصفة لكل 1 كجم)</span>
              </label>
            )}
          </div>

          {renderImageField(itemForm.imageUrl, true)}

          {/* Sizes — products + services (not weighted, not raw_material) */}
          {itemForm.itemType !== 'raw_material' && renderSizeSection(itemForm.sizeOptions, itemForm.isWeighted, true)}

          {/* Weighted pricing — products only */}
          {itemForm.itemType === 'product' && itemForm.isWeighted && (
            <div className="weighted-pricing-editor">
              <h3>أسعار الميزان</h3>
              {itemForm.weightedPriceOptions.map((o, idx) => (
                <div key={o.id} className="weighted-pricing-row">
                  <input value={o.label} onChange={(e) => setItemForm((f) => { const w=[...f.weightedPriceOptions]; w[idx]={...w[idx]!,label:e.target.value}; return {...f,weightedPriceOptions:w} })} placeholder="اسم الزر" />
                  <input type="number" min="1" step="1" value={o.weightGrams} onChange={(e) => setItemForm((f) => { const w=[...f.weightedPriceOptions]; w[idx]={...w[idx]!,weightGrams:e.target.value}; return {...f,weightedPriceOptions:w} })} placeholder="جرام" />
                  <input type="number" min="0" step="0.01" value={o.price} onChange={(e) => setItemForm((f) => { const w=[...f.weightedPriceOptions]; w[idx]={...w[idx]!,price:e.target.value}; return {...f,weightedPriceOptions:w} })} placeholder="السعر" />
                  <button type="button" className="btn btn--danger btn--sm" onClick={() => setItemForm((f) => ({ ...f, weightedPriceOptions: f.weightedPriceOptions.filter((_,i)=>i!==idx) }))}><MdClose /></button>
                </div>
              ))}
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setItemForm((f) => ({ ...f, weightedPriceOptions: [...f.weightedPriceOptions, newWeightedOption()] }))}>+ سعر ميزان</button>
              <label className="field field--checkbox mt-8">
                <input type="checkbox" checked={itemForm.allowCustomWeight} onChange={(e) => setItemForm((f) => ({ ...f, allowCustomWeight: e.target.checked }))} />
                <span>السماح بوزن مخصص</span>
              </label>
              {itemForm.allowCustomWeight && (
                <label className="field">
                  <span>سعر الكيلو للوزن المخصص</span>
                  <input type="number" min="0" step="0.01" value={itemForm.customWeightUnitPrice} onChange={(e) => setItemForm((f) => ({ ...f, customWeightUnitPrice: e.target.value }))} required />
                </label>
              )}
            </div>
          )}

          {/* Attachments — products + services */}
          {itemForm.itemType !== 'raw_material' && renderAttachmentsSection(itemForm.attachments, true)}
          {renderPrinterSection(itemForm.kitchenPrinterIds, true)}

          {/* Recipe lines — only for recipe-type products */}
          {showRecipeSection && (
            <>
              <h3 style={{ margin: '12px 0 8px', fontWeight: 700 }}>
                مكوّنات الوصفة
                <span style={{ fontSize: '0.78rem', color: 'var(--color-muted)', fontWeight: 400, marginRight: 8 }}>(اختياري — اتركه فارغاً إذا لم تريد خصم مخزون)</span>
              </h3>
              {itemForm.lines.map((line, idx) => (
                <div key={idx} className="page-toolbar" style={{ gap: 6 }}>
                  <select value={line.ingredientId} onChange={(e) => {
                    const lines = [...itemForm.lines]
                    const ing = ingredients.find((i) => i.id === e.target.value)
                    lines[idx] = { ...lines[idx]!, ingredientId: e.target.value, unit: ing?.unit ?? 'جرام' }
                    setItemForm((f) => ({ ...f, lines }))
                  }}>
                    <option value="">مكوّن...</option>
                    {ingredients.map((i) => <option key={i.id} value={i.id}>{i.nameAr}</option>)}
                  </select>
                  <input type="number" placeholder="الكمية" value={line.quantity} onChange={(e) => { const lines=[...itemForm.lines]; lines[idx]={...lines[idx]!,quantity:e.target.value}; setItemForm((f)=>({...f,lines})) }} style={{ width: 80 }} />
                  <span style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>{line.unit}</span>
                  {itemForm.lines.length > 1 && <button type="button" className="btn btn--danger btn--sm" onClick={() => setItemForm((f) => ({ ...f, lines: f.lines.filter((_,i)=>i!==idx) }))}><MdClose /></button>}
                </div>
              ))}
              <div className="form-actions">
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => setItemForm((f) => ({ ...f, lines: [...f.lines, { ingredientId: '', quantity: '', unit: 'جرام' }] }))}>+ سطر وصفة</button>
              </div>
            </>
          )}

      </FormModal>

      {/* ── Items table ── */}
      <div className="card">
        <h2 className="card__title">أصناف القائمة ({items.length})</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>ترتيب</th><th>الصنف</th><th>النوع</th><th>السعر</th>
              <th>التصنيف</th><th>الحالة</th><th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const linkedPrinterNames = (item.kitchenPrinterIds ?? [])
                .map((id) => printers.find((printer) => printer.id === id)?.name)
                .filter(Boolean)
              return (
                <tr key={item.id}>
                  <td>
                    <div className="sort-arrows">
                      <button type="button" className="sort-arrow-btn" disabled={idx === 0} onClick={() => void moveMenuItem(idx, -1)}><MdArrowUpward /></button>
                      <button type="button" className="sort-arrow-btn" disabled={idx === items.length - 1} onClick={() => void moveMenuItem(idx, 1)}><MdArrowDownward /></button>
                    </div>
                  </td>
                  <td>
                    <div>
                      {item.imageUrl && <img className="product-list-thumb" src={item.imageUrl} alt="" />}
                      <div>{item.nameAr}</div>
                      {linkedPrinterNames.length > 0 && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-muted)', marginTop: 3 }}>
                          <MdPrint style={{ verticalAlign: 'middle', marginLeft: 3 }} />
                          {linkedPrinterNames.join('، ')}
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <div>
                      <span className={`items-type-badge items-type-badge--${item.itemType ?? 'product'}`}>
                        {ITEM_TYPE_LABELS[item.itemType ?? 'product']}
                      </span>
                      {item.itemType === 'product' && item.productType && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-muted)', marginTop: 2 }}>
                          {PRODUCT_TYPE_LABELS[item.productType]}
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    {item.isWeighted ? 'ميزان' : item.price.toFixed(2)}
                  </td>
                  <td>
                    {categories.find((c) => c.id === item.categoryId)?.nameAr ?? '-'}
                  </td>
                  <td>
                    <span style={{color:item.active?'var(--color-success)':'var(--color-muted)',fontWeight:700,fontSize:'0.82rem'}}>{item.active?'مفعّل':'معطّل'}</span>
                  </td>
                  <td>
                    <div className="table-actions">
                      <button type="button" className="btn btn--secondary btn--sm" onClick={()=>startEditItem(item)}><MdEdit/> تعديل</button>
                      {(item.itemType == null || item.itemType === 'product') && item.productType !== 'no_inventory' && item.productType !== 'ready_made' && item.productType !== 'manufactured' && (
                        <button type="button" className="btn btn--secondary btn--sm" onClick={()=>void openRecipe(item)}>الوصفة</button>
                      )}
                      <ConfirmDialog
                        open={itemToDelete === item.id}
                        onCancel={() => setItemToDelete(null)}
                        onConfirm={async () => {
                          await deleteMenuItem(item.id, item.recipeId, user)
                          setItemToDelete(null)
                          await onRefresh()
                        }}
                        title="تأكيد الحذف"
                        message={`حذف "${item.nameAr}"؟`}
                        confirmLabel="حذف"
                        danger
                      />
                      <button type="button" className="btn btn--danger btn--sm" onClick={() => setItemToDelete(item.id)}><MdDelete /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <FormModal
        open={!!editingItem}
        onClose={() => setEditingItem(null)}
        entityName="صنف"
        isEdit
        onSubmit={saveItemEdit}
        maxWidth={980}
      >
        {editingItem && (
          <>
            <div className="settings-form-grid">
              <label className="field">
                <span>التصنيف</span>
                <select value={editingItem.categoryId} onChange={(e) => setEditingItem({ ...editingItem, categoryId: e.target.value })}>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
                </select>
              </label>
              <label className="field">
                <span>اسم الصنف</span>
                <input value={editingItem.nameAr} onChange={(e) => setEditingItem({ ...editingItem, nameAr: e.target.value })} autoFocus />
              </label>
              <label className="field">
                <span>نوع الصنف</span>
                <select value={editingItem.itemType} onChange={(e) => setEditingItem({ ...editingItem, itemType: e.target.value as MenuItemType, productType: 'recipe' })}>
                  {(Object.entries(ITEM_TYPE_LABELS) as [MenuItemType, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              {editingItem.itemType === 'product' && (
                <label className="field">
                  <span>نوع المنتج</span>
                  <select value={editingItem.productType} onChange={(e) => setEditingItem({ ...editingItem, productType: e.target.value as ProductType })}>
                    {(Object.entries(PRODUCT_TYPE_LABELS) as [ProductType, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
              )}
              {needsLinkedStock(editingItem.itemType, editingItem.productType) && (
                <label className="field">
                  <span>رصيد المخزون المرتبط</span>
                  <select value={editingItem.linkedIngredientId} onChange={(e) => setEditingItem({ ...editingItem, linkedIngredientId: e.target.value })}>
                    <option value="">بدون ربط مخزون</option>
                    {ingredients.filter((i) => i.active).map((i) => <option key={i.id} value={i.id}>{i.nameAr} ({i.unit})</option>)}
                  </select>
                </label>
              )}
              {!editingItem.isWeighted && (
                <label className="field">
                  <span>السعر</span>
                  <input type="number" min="0" step="0.01" value={editingItem.price} onChange={(e) => setEditingItem({ ...editingItem, price: e.target.value })} />
                </label>
              )}
              <label className="field">
                <span>الحالة</span>
                <select value={editingItem.active ? 'active' : 'inactive'} onChange={(e) => setEditingItem({ ...editingItem, active: e.target.value === 'active' })}>
                  <option value="active">مفعّل</option>
                  <option value="inactive">معطّل</option>
                </select>
              </label>
              {editingItem.itemType === 'product' && (
                <label className="field field--checkbox settings-form-grid__full">
                  <input type="checkbox" checked={editingItem.isWeighted} onChange={(e) => setEditingItem({ ...editingItem, isWeighted: e.target.checked, weightedPriceOptions: e.target.checked && editingItem.weightedPriceOptions.length === 0 ? [newWeightedOption(true)] : editingItem.weightedPriceOptions })} />
                  <span>منتج ميزان</span>
                </label>
              )}
            </div>

            {renderImageField(editingItem.imageUrl, false)}
            {editingItem.itemType !== 'raw_material' && renderSizeSection(editingItem.sizeOptions, editingItem.isWeighted, false)}
            {editingItem.itemType !== 'raw_material' && renderAttachmentsSection(editingItem.attachments, false)}
            {renderPrinterSection(editingItem.kitchenPrinterIds, false)}

            {editingItem.itemType === 'product' && editingItem.isWeighted && (
              <div className="weighted-pricing-editor">
                <h3>أسعار الميزان</h3>
                {editingItem.weightedPriceOptions.map((o, idx) => (
                  <div key={o.id} className="weighted-pricing-row">
                    <input value={o.label} onChange={(e) => setEditingItem((p) => p ? { ...p, weightedPriceOptions: p.weightedPriceOptions.map((w, i) => i === idx ? { ...w, label: e.target.value } : w) } : p)} placeholder="اسم الزر" />
                    <input type="number" min="1" step="1" value={o.weightGrams} onChange={(e) => setEditingItem((p) => p ? { ...p, weightedPriceOptions: p.weightedPriceOptions.map((w, i) => i === idx ? { ...w, weightGrams: e.target.value } : w) } : p)} placeholder="جرام" />
                    <input type="number" min="0" step="0.01" value={o.price} onChange={(e) => setEditingItem((p) => p ? { ...p, weightedPriceOptions: p.weightedPriceOptions.map((w, i) => i === idx ? { ...w, price: e.target.value } : w) } : p)} placeholder="السعر" />
                    <button type="button" className="btn btn--danger btn--sm" onClick={() => setEditingItem((p) => p ? { ...p, weightedPriceOptions: p.weightedPriceOptions.filter((_, i) => i !== idx) } : p)}><MdClose /></button>
                  </div>
                ))}
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditingItem((p) => p ? { ...p, weightedPriceOptions: [...p.weightedPriceOptions, newWeightedOption()] } : p)}>+ سعر ميزان</button>
                <label className="field field--checkbox mt-8">
                  <input type="checkbox" checked={editingItem.allowCustomWeight} onChange={(e) => setEditingItem({ ...editingItem, allowCustomWeight: e.target.checked })} />
                  <span>السماح بوزن مخصص</span>
                </label>
                {editingItem.allowCustomWeight && (
                  <label className="field">
                    <span>سعر الكيلو للوزن المخصص</span>
                    <input type="number" min="0" step="0.01" value={editingItem.customWeightUnitPrice} onChange={(e) => setEditingItem({ ...editingItem, customWeightUnitPrice: e.target.value })} />
                  </label>
                )}
              </div>
            )}

            {showEditRecipeSection && (
              <p style={{ fontSize: '0.82rem', color: 'var(--color-muted)', fontStyle: 'italic' }}>
                لتعديل مكوّنات الوصفة اضغط "الوصفة" بعد حفظ بيانات الصنف.
              </p>
            )}
          </>
        )}
      </FormModal>

      {/* Recipe modal */}
      <FormModal
        open={!!editingRecipeId}
        onClose={() => setEditingRecipeId(null)}
        entityName="وصفة"
        isEdit
        onSubmit={saveRecipe}
      >
        {editingRecipeId && (
          <div>
            {recipeLines.map((line, idx) => (
              <div key={idx} className="page-toolbar" style={{ gap: 6, marginBottom: 8 }}>
                <select value={line.ingredientId} onChange={(e) => { const next=[...recipeLines]; const ing=ingredients.find((i)=>i.id===e.target.value); next[idx]={...next[idx]!,ingredientId:e.target.value,unit:ing?.unit??line.unit}; setRecipeLines(next) }}>{ingredients.map((i)=><option key={i.id} value={i.id}>{i.nameAr}</option>)}</select>
                <input type="number" value={line.quantity} style={{ width: 80 }} onChange={(e) => { const next=[...recipeLines]; next[idx]={...next[idx]!,quantity:Number(e.target.value)}; setRecipeLines(next) }} />
                <span style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>{line.unit}</span>
                <button type="button" className="btn btn--danger btn--sm" onClick={() => setRecipeLines((l)=>l.filter((_,i)=>i!==idx))}><MdClose /></button>
              </div>
            ))}
            <div className="form-actions mt-12">
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setRecipeLines((l)=>[...l,{ingredientId:ingredients[0]?.id??'',quantity:1,unit:ingredients[0]?.unit??'جرام'}])}>+ مكوّن</button>
            </div>
          </div>
        )}
      </FormModal>
    </div>
  )
}
// ── Main page ───────────────────────────────────────────────────────────────

type ItemsPageTab = 'items' | 'sizes' | 'addons' | 'raw_materials'

export function ItemsPage(): React.ReactElement {
  const { saved, save } = usePageState<{
    activeTab: ItemsPageTab
    itemForm: ItemFormState
  }>('/manager/items')

  const [activeTab, setActiveTab] = useState<ItemsPageTab>(() => {
    return saved.activeTab === 'sizes' || saved.activeTab === 'addons' || saved.activeTab === 'raw_materials'
      ? saved.activeTab
      : 'items'
  })
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [sizes, setSizes] = useState<ItemSize[]>([])
  const [addons, setAddons] = useState<ItemAddon[]>([])
  const [printers, setPrinters] = useState<KitchenPrinter[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const tabListRef = useRef<HTMLDivElement>(null)
  const addItemFormRef = useRef<HTMLFormElement>(null)

  const [itemForm, setItemForm] = useState<ItemFormState>(() => {
    const s = saved.itemForm
    if (s) return { ...defaultItemForm, ...(s as ItemFormState), kitchenPrinterIds: (s as ItemFormState).kitchenPrinterIds ?? [] }
    return { ...defaultItemForm, weightedPriceOptions: [newWeightedOption(true)] }
  })

  useEffect(() => { save({ activeTab }) }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { save({ itemForm }) }, [itemForm])   // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    const [cats, menu, ing, szs, adns, prns] = await Promise.all([
      listCategories(),
      listMenuItems(),
      listIngredients(),
      listSizes(),
      listAddons(),
      listKitchenPrinters()
    ])
    setCategories(cats)
    setItems(menu)
    setIngredients(ing)
    setSizes(szs)
    setAddons(adns)
    setPrinters(prns)
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 4000)
    return () => clearTimeout(t)
  }, [message])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (!e.ctrlKey) return
      if (e.key === 's') {
        const form = document.getElementById('form-modal-form') as HTMLFormElement
        if (form) form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
        return
      }
      const index = Number(e.key)
      if (!Number.isInteger(index) || index < 1 || index > 5) return
      e.preventDefault()
      const nextTab = tabs[index - 1]
      if (nextTab) setActiveTab(nextTab.key)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  const tabs: { key: ItemsPageTab; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'items',        label: 'الأصناف',     icon: <MdMenuBook />,   count: items.length },
    { key: 'sizes',        label: 'الأحجام',     icon: <MdStraighten />, count: sizes.length },
    { key: 'addons',       label: 'الإضافات',    icon: <MdAddBox />,     count: addons.length },
    { key: 'raw_materials',label: 'المواد الخام', icon: <MdInventory2 />, count: ingredients.length },
  ]

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
            {t.count !== undefined && <span className="inner-tab__count">{t.count}</span>}
          </button>
        ))}
      </div>

      {message && (
        <p className={`form-message ${message.includes('فشل') || message.includes('لا يمكن') ? 'form-message--error' : 'form-message--ok'}`} role="status">
          {message}
        </p>
      )}

      {activeTab === 'items' && (
        <ItemsTab
          categories={categories}
          items={items}
          ingredients={ingredients}
          sizes={sizes}
          addons={addons}
          printers={printers}
          onRefresh={load}
          setMessage={setMessage}
          itemForm={itemForm}
          setItemForm={setItemForm}
          formRef={addItemFormRef}
        />
      )}
      {activeTab === 'sizes'         && <SizesTab         sizes={sizes}             onRefresh={load} setMessage={setMessage} />}
      {activeTab === 'addons'        && <AddonsTab        addons={addons}           onRefresh={load} setMessage={setMessage} />}
      {activeTab === 'raw_materials' && <RawMaterialsTab  ingredients={ingredients} onRefresh={load} setMessage={setMessage} />}
    </div>
  )
}
