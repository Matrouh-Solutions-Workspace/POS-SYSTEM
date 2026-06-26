import type {
  MenuItemType,
  ProductType,
  MenuItemAttachment,
  MenuItemSizeOption,
  WeightedPriceOption,
  ItemSize,
  ItemAddon
} from '@shared/types'

export type WeightedPriceOptionForm = { id: string; label: string; weightGrams: string; price: string }
export type SizeOptionForm           = { id: string; masterSizeId: string; labelAr: string; price: string }
export type AttachmentForm           = { id: string; masterAddonId: string; nameAr: string; price: string }
export type RecipeLineForm           = { ingredientId: string; quantity: string; unit: string }

export type ItemEditState = {
  id: string; nameAr: string; price: string; categoryId: string
  itemType: MenuItemType; productType: ProductType; linkedIngredientId: string
  sizeOptions: SizeOptionForm[]; attachments: AttachmentForm[]
  isWeighted: boolean; weightedPriceOptions: WeightedPriceOptionForm[]
  allowCustomWeight: boolean; customWeightUnitPrice: string; active: boolean
  kitchenPrinterIds: string[]
  imageUrl: string
}

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

export function newWeightedOption(kiloPreset = false): WeightedPriceOptionForm {
  return { id: crypto.randomUUID(), label: kiloPreset ? '1 كجم' : '', weightGrams: kiloPreset ? '1000' : '', price: '' }
}
export function newSizeOption(): SizeOptionForm  { return { id: crypto.randomUUID(), masterSizeId: '', labelAr: '', price: '' } }
export function newAttachment(): AttachmentForm  { return { id: crypto.randomUUID(), masterAddonId: '', nameAr: '', price: '' } }

export function toWeightedOptionForm(o: WeightedPriceOption): WeightedPriceOptionForm {
  return { id: o.id, label: o.label, weightGrams: String(Math.round(o.weightKg * 1000)), price: String(o.price) }
}
export function toSizeOptionForm(o: MenuItemSizeOption): SizeOptionForm {
  return { id: o.id, masterSizeId: o.masterSizeId ?? '', labelAr: o.labelAr, price: String(o.price) }
}
export function toAttachmentForm(o: MenuItemAttachment): AttachmentForm {
  return { id: o.id, masterAddonId: o.masterAddonId ?? '', nameAr: o.nameAr, price: String(o.price) }
}
export function normalizeWeightedOptions(opts: WeightedPriceOptionForm[]): WeightedPriceOption[] {
  return opts
    .map((o) => ({ id: o.id || crypto.randomUUID(), label: o.label.trim(), weightKg: Number(o.weightGrams) / 1000, price: Number(o.price) }))
    .filter((o) => o.label && o.weightKg > 0 && o.price >= 0)
}
export function normalizeSizeOptions(opts: SizeOptionForm[], sizes: ItemSize[]): MenuItemSizeOption[] {
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
export function normalizeAttachments(opts: AttachmentForm[], addons: ItemAddon[]): MenuItemAttachment[] {
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

export function cloneItemFormForRepeat(form: ItemFormState): ItemFormState {
  return {
    ...form,
    sizeOptions: form.sizeOptions.map((option) => ({ ...option, id: crypto.randomUUID() })),
    attachments: form.attachments.map((attachment) => ({ ...attachment, id: crypto.randomUUID() })),
    weightedPriceOptions: form.weightedPriceOptions.map((option) => ({ ...option, id: crypto.randomUUID() })),
    lines: form.lines.map((line) => ({ ...line }))
  }
}

// labels for itemType + productType
export const ITEM_TYPE_LABELS: Record<MenuItemType, string> = {
  product: 'منتج',
  raw_material: 'مادة خام',
  service: 'خدمة'
}
export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  recipe: 'وصفة (يُحضَّر لحظة البيع)',
  ready_made: 'جاهز (له مخزون)',
  manufactured: 'مصنوع داخلياً (له مخزون)',
  no_inventory: 'جاهز (بدون مخزون)'
}

/** Whether this product type should show recipe lines (ingredient deduction) */
export function needsRecipe(itemType: MenuItemType, productType: ProductType): boolean {
  if (itemType === 'service') return false
  if (itemType === 'raw_material') return false
  return productType === 'recipe'
}

export function needsLinkedStock(itemType: MenuItemType, productType: ProductType): boolean {
  if (itemType === 'raw_material') return true
  if (itemType !== 'product') return false
  return productType === 'ready_made' || productType === 'manufactured'
}

export function moveItem<T>(arr: T[], idx: number, dir: -1 | 1): T[] {
  const next = [...arr]
  const target = idx + dir
  if (target < 0 || target >= next.length) return next
  ;[next[idx], next[target]] = [next[target]!, next[idx]!]
  return next
}

export async function optimizeProductImage(file: File): Promise<string> {
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
