/** Stable entity collection names shared across local storage and API sync. */
export const COLLECTIONS = {
  users: 'users',
  menuCategories: 'menu_categories',
  menuItems: 'menu_items',
  recipes: 'recipes',
  ingredients: 'ingredients',
  inventoryTransactions: 'inventory_transactions',
  orders: 'orders',
  orderItems: 'order_items',
  payments: 'payments',
  diningTables: 'dining_tables',
  floors: 'floors',
  shifts: 'shifts',
  cashDrawerTransactions: 'cash_drawer_transactions',
  suppliers: 'suppliers',
  supplierTransactions: 'supplier_transactions',
  settings: 'settings',
  auditLog: 'audit_log',
  itemSizes: 'item_sizes',
  itemAddons: 'item_addons',
  kitchenPrinters: 'kitchen_printers'
} as const

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS]

export const SETTINGS_DOC_ID = 'app'
