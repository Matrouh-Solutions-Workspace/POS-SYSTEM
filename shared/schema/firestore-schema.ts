/**
 * Firestore document shapes and field constraints.
 * Portable schema documentation for desktop + future React Native.
 */
import type {
  AppUser,
  Ingredient,
  InventoryTransaction,
  MenuCategory,
  MenuItem,
  Order,
  OrderItem,
  Payment,
  DiningTable,
  Floor,
  Recipe,
  AppSettings,
  Shift,
  CashDrawerTransaction,
  Supplier,
  SupplierTransaction,
  ItemSize,
  ItemAddon,
  KitchenPrinter
} from '../types'

export type FirestoreDoc<T> = T

export interface FirestoreSchema {
  users: FirestoreDoc<AppUser>
  menu_categories: FirestoreDoc<MenuCategory>
  menu_items: FirestoreDoc<MenuItem>
  recipes: FirestoreDoc<Recipe>
  ingredients: FirestoreDoc<Ingredient>
  inventory_transactions: FirestoreDoc<InventoryTransaction>
  orders: FirestoreDoc<Order>
  order_items: FirestoreDoc<OrderItem>
  payments: FirestoreDoc<Payment>
  dining_tables: FirestoreDoc<DiningTable>
  floors: FirestoreDoc<Floor>
  shifts: FirestoreDoc<Shift>
  cash_drawer_transactions: FirestoreDoc<CashDrawerTransaction>
  suppliers: FirestoreDoc<Supplier>
  supplier_transactions: FirestoreDoc<SupplierTransaction>
  settings: FirestoreDoc<AppSettings>
  item_sizes: FirestoreDoc<ItemSize>
  item_addons: FirestoreDoc<ItemAddon>
  kitchen_printers: FirestoreDoc<KitchenPrinter>
}

/** Default settings document id */
export const SETTINGS_DOC_ID = 'app'

/** Indexes recommended in Firebase console */
export const FIRESTORE_INDEX_HINTS = [
  'inventory_transactions: ingredientId ASC, createdAt DESC',
  'orders: status ASC, createdAt DESC',
  'orders: shiftId ASC',
  'order_items: orderId ASC',
  'dining_tables: sortOrder ASC',
  'menu_items: categoryId ASC, sortOrder ASC',
  'recipes: menuItemId ASC'
] as const
