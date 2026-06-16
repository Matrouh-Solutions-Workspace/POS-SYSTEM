/**
 * Menu service — SQLite primary database.
 * All reads/writes go to SQLite first; Firebase receives changes via outbox.
 */
import type { MenuCategory, MenuItem, Recipe, RecipeLine } from '@shared/types'
import { COLLECTIONS } from '@shared/constants/collections'
import { cacheDocs, getCachedDoc, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { dbDelete } from '@renderer/lib/db/sqlite-db'
import { generateId } from '@renderer/lib/utils/id'

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories(): Promise<MenuCategory[]> {
  const cats = await getCachedDocs<MenuCategory>(COLLECTIONS.menuCategories)
  return cats.sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function createCategory(
  nameAr: string,
  sortOrder: number,
  parentId?: string
): Promise<MenuCategory> {
  const now = Date.now()
  const cat: MenuCategory = {
    id: generateId(),
    parentId,
    nameAr,
    sortOrder,
    active: true,
    createdAt: now,
    updatedAt: now
  }
  await cacheDocs(COLLECTIONS.menuCategories, [cat])
  return cat
}

export async function updateCategory(
  id: string,
  patch: Partial<Pick<MenuCategory, 'nameAr' | 'parentId' | 'sortOrder' | 'active'>>
): Promise<void> {
  const cached = await getCachedDoc<MenuCategory>(COLLECTIONS.menuCategories, id)
  if (!cached) return
  await cacheDocs(COLLECTIONS.menuCategories, [{ ...cached, ...patch, updatedAt: Date.now() }])
}

export async function deleteCategory(id: string): Promise<void> {
  // Check if category has menu items
  const items = await getCachedDocs<MenuItem>(COLLECTIONS.menuItems)
  if (items.some((item) => item.categoryId === id)) {
    throw new Error('لا يمكن الحذف — التصنيف يحتوي أصنافاً. احذف الأصناف أولاً.')
  }
  await dbDelete(COLLECTIONS.menuCategories, id)
}

export async function reorderCategories(
  cats: Array<{ id: string; sortOrder: number }>
): Promise<void> {
  const cached = await getCachedDocs<MenuCategory>(COLLECTIONS.menuCategories)
  const sortById = new Map(cats.map((c) => [c.id, c.sortOrder]))
  const updates = cached
    .filter((cat) => sortById.has(cat.id))
    .map((cat) => ({ ...cat, sortOrder: sortById.get(cat.id) ?? cat.sortOrder, updatedAt: Date.now() }))
  if (updates.length) await cacheDocs(COLLECTIONS.menuCategories, updates)
}

// ---------------------------------------------------------------------------
// Menu items
// ---------------------------------------------------------------------------

export async function listMenuItems(activeOnly = false): Promise<MenuItem[]> {
  let items = await getCachedDocs<MenuItem>(COLLECTIONS.menuItems)
  if (activeOnly) items = items.filter((i) => i.active)
  return items.sort((a, b) => {
    const ao = a.sortOrder ?? 9999
    const bo = b.sortOrder ?? 9999
    if (ao !== bo) return ao - bo
    return a.nameAr.localeCompare(b.nameAr, 'ar')
  })
}

export async function updateMenuItem(
  id: string,
  patch: Partial<
    Pick<
      MenuItem,
      | 'nameAr'
      | 'price'
      | 'categoryId'
      | 'itemType'
      | 'productType'
      | 'linkedIngredientId'
      | 'sizeOptions'
      | 'attachments'
      | 'isWeighted'
      | 'weightedPriceOptions'
      | 'allowCustomWeight'
      | 'customWeightUnitPrice'
      | 'kitchenPrinterIds'
      | 'active'
    >
  >
): Promise<void> {
  const cached = await getCachedDoc<MenuItem>(COLLECTIONS.menuItems, id)
  if (!cached) return
  await cacheDocs(COLLECTIONS.menuItems, [{ ...cached, ...patch, updatedAt: Date.now() }])
}

export async function reorderMenuItems(
  items: Array<{ id: string; sortOrder: number }>
): Promise<void> {
  const cached = await getCachedDocs<MenuItem>(COLLECTIONS.menuItems)
  const sortById = new Map(items.map((i) => [i.id, i.sortOrder]))
  const updates = cached
    .filter((item) => sortById.has(item.id))
    .map((item) => ({ ...item, sortOrder: sortById.get(item.id), updatedAt: Date.now() }))
  if (updates.length) await cacheDocs(COLLECTIONS.menuItems, updates)
}

export async function createMenuItemWithRecipe(params: {
  categoryId: string
  nameAr: string
  descriptionAr?: string
  price: number
  itemType?: MenuItem['itemType']
  productType?: MenuItem['productType']
  linkedIngredientId?: string
  sizeOptions?: MenuItem['sizeOptions']
  attachments?: MenuItem['attachments']
  isWeighted?: boolean
  weightedPriceOptions?: MenuItem['weightedPriceOptions']
  allowCustomWeight?: boolean
  customWeightUnitPrice?: number
  kitchenPrinterIds?: string[]
  lines: RecipeLine[]   // empty array = no inventory deduction
  sortOrder?: number
}): Promise<{ item: MenuItem; recipe: Recipe }> {
  const now = Date.now()
  const recipeId = generateId()
  const itemId = generateId()

  const recipe: Recipe = {
    id: recipeId,
    menuItemId: itemId,
    nameAr: params.nameAr,
    basisQuantity: params.isWeighted ? 1 : undefined,
    basisUnit: params.isWeighted ? 'kg' : undefined,
    lines: params.lines,
    createdAt: now,
    updatedAt: now
  }

  const item: MenuItem = {
    id: itemId,
    categoryId: params.categoryId,
    nameAr: params.nameAr,
    descriptionAr: params.descriptionAr,
    price: params.price,
    itemType: params.itemType ?? 'product',
    productType: params.productType,
    linkedIngredientId: params.linkedIngredientId,
    sizeOptions: params.sizeOptions,
    attachments: params.attachments,
    isWeighted: params.isWeighted,
    weightedPriceOptions: params.isWeighted ? params.weightedPriceOptions : undefined,
    allowCustomWeight: params.isWeighted ? params.allowCustomWeight : undefined,
    customWeightUnitPrice: params.isWeighted ? params.customWeightUnitPrice : undefined,
    kitchenPrinterIds: params.kitchenPrinterIds ?? [],
    active: true,
    recipeId,
    sortOrder: params.sortOrder ?? 9999,
    createdAt: now,
    updatedAt: now
  }

  await Promise.all([
    cacheDocs(COLLECTIONS.menuItems, [item]),
    cacheDocs(COLLECTIONS.recipes, [recipe])
  ])
  return { item, recipe }
}

export async function deleteMenuItem(id: string, recipeId: string): Promise<void> {
  await Promise.all([
    dbDelete(COLLECTIONS.menuItems, id),
    dbDelete(COLLECTIONS.recipes, recipeId)
  ])
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export async function getRecipeByMenuItem(menuItemId: string): Promise<Recipe | null> {
  const recipes = await getCachedDocs<Recipe>(COLLECTIONS.recipes)
  return recipes.find((r) => r.menuItemId === menuItemId) ?? null
}

export async function getRecipe(recipeId: string): Promise<Recipe | null> {
  return getCachedDoc<Recipe>(COLLECTIONS.recipes, recipeId)
}

export async function updateRecipe(
  recipeId: string,
  lines: RecipeLine[],
  nameAr?: string
): Promise<void> {
  const cached = await getCachedDoc<Recipe>(COLLECTIONS.recipes, recipeId)
  if (!cached) return
  await cacheDocs(COLLECTIONS.recipes, [
    { ...cached, lines, ...(nameAr ? { nameAr } : {}), updatedAt: Date.now() }
  ])
}
