/** Stable entity collection names shared across local storage and API sync. */
export const COLLECTIONS = {
  users: 'users',
  menuCategories: 'menu_categories',
  menuItems: 'menu_items',
  recipes: 'recipes',
  ingredients: 'ingredients',
  inventoryTransactions: 'inventory_transactions',
  inventoryBatches: 'inventory_batches',
  supplierReturns: 'supplier_returns',
  supplierReturnItems: 'supplier_return_items',
  productImages: 'product_images',
  orders: 'orders',
  orderItems: 'order_items',
  payments: 'payments',
  diningTables: 'dining_tables',
  floors: 'floors',
  shifts: 'shifts',
  workShifts: 'work_shifts',
  userShiftAssignments: 'user_shift_assignments',
  overtimeRecords: 'overtime_records',
  employeeActivityLogs: 'employee_activity_logs',
  employeePerformanceDaily: 'employee_performance_daily',
  shiftClosureRecords: 'shift_closure_records',
  cashRoundingTransactions: 'cash_rounding_transactions',
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
