export interface MenuCategory {
  id: string
  parentId?: string
  nameAr: string
  sortOrder: number
  active: boolean
  createdAt: number
  updatedAt: number
}

/**
 * itemType:
 *   'product'      — a menu product (recipe-based, ready-made, manufactured, or no-inventory)
 *   'raw_material' — a raw material / ingredient that can also be sold directly
 *   'service'      — a paid service with no inventory tracking
 */
export type MenuItemType = 'product' | 'raw_material' | 'service'

/**
 * productType (only relevant when itemType === 'product'):
 *   'recipe'        — prepared from ingredients at time of sale (deducts recipe from stock)
 *   'ready_made'    — purchased from suppliers, has own inventory stock
 *   'manufactured'  — produced internally, stored in inventory
 *   'no_inventory'  — ready-made for selling only, no stock tracking
 */
export type ProductType = 'recipe' | 'ready_made' | 'manufactured' | 'no_inventory'

export interface MenuItem {
  id: string
  categoryId: string
  nameAr: string
  descriptionAr?: string
  price: number
  /** Item classification — defaults to 'product' for backward compat */
  itemType?: MenuItemType
  /** Only set when itemType === 'product' */
  productType?: ProductType
  /** Backing ingredient id for stocked sellables and direct-sale raw materials */
  linkedIngredientId?: string
  sizeOptions?: MenuItemSizeOption[]
  attachments?: MenuItemAttachment[]
  isWeighted?: boolean
  weightedPriceOptions?: WeightedPriceOption[]
  allowCustomWeight?: boolean
  customWeightUnitPrice?: number
  imageUrl?: string
  active: boolean
  recipeId: string
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface MenuItemSizeOption {
  id: string
  /** Master size id — references ItemSize.id */
  masterSizeId?: string
  labelAr: string
  price: number
}

export interface MenuItemAttachment {
  id: string
  /** Master addon id — references ItemAddon.id */
  masterAddonId?: string
  nameAr: string
  price: number
}

/** Master size definition — predefined list managed from Sizes page */
export interface ItemSize {
  id: string
  nameAr: string
  sortOrder: number
  active: boolean
  createdAt: number
  updatedAt: number
}

/** Master add-on definition — predefined list managed from Add-ons page */
export interface ItemAddon {
  id: string
  nameAr: string
  /** Default price suggestion (can be overridden per product) */
  defaultPrice: number
  sortOrder: number
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface WeightedPriceOption {
  id: string
  label: string
  weightKg: number
  price: number
}

export interface RecipeLine {
  ingredientId: string
  quantity: number
  unit: string
}

export interface Recipe {
  id: string
  menuItemId: string
  nameAr: string
  basisQuantity?: number
  basisUnit?: string
  lines: RecipeLine[]
  createdAt: number
  updatedAt: number
}
