export type UserRole = 'manager' | 'supervisor' | 'cashier'

// ---------------------------------------------------------------------------
// Permission system — stored per-user, not derived from role
// ---------------------------------------------------------------------------

export type Permission =
  | 'pos'               // Access the POS terminal
  | 'order_history'     // View and manage order history
  | 'cashier_inventory' // Record purchases and expenses from cashier screen
  | 'view_reports'      // View reports and shift summaries
  | 'manage_shifts'     // Open, close, archive shifts
  | 'manage_menu'       // Edit menu items, categories, recipes
  | 'manage_purchases'  // Manage stock, ingredients, purchases
  | 'manage_suppliers'  // Manage suppliers and transactions
  | 'manage_accounts'   // Create/edit/delete user accounts
  | 'manage_settings'   // Edit restaurant settings, tables, theme

export interface AppUser {
  id: string
  email: string
  username: string
  displayName: string
  cashierCode?: string
  role: UserRole
  /** Explicit permissions — if set, overrides role defaults */
  permissions?: Permission[]
  active: boolean
  pinHash?: string        // SHA-256 of the 4-digit PIN, undefined = no PIN set
  createdAt: number
  updatedAt: number
}

export interface AppUserCreate {
  username: string
  displayName: string
  cashierCode?: string
  role: UserRole
  permissions: Permission[]
  password: string
}

// ---------------------------------------------------------------------------
// Role presets — used as starting points in the UI, not enforced
// ---------------------------------------------------------------------------

export const ROLE_PRESET_PERMISSIONS: Record<UserRole, Permission[]> = {
  manager: [
    'pos', 'order_history', 'cashier_inventory',
    'view_reports', 'manage_shifts', 'manage_menu',
    'manage_purchases', 'manage_suppliers',
    'manage_accounts', 'manage_settings'
  ],
  supervisor: [
    'pos', 'order_history', 'cashier_inventory',
    'view_reports', 'manage_shifts', 'manage_purchases',
    'manage_suppliers'
  ],
  cashier: [
    'pos', 'order_history', 'cashier_inventory'
  ]
}

export const ROLE_LABELS: Record<UserRole, string> = {
  manager:    'مدير',
  supervisor: 'مشرف',
  cashier:    'كاشير'
}

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  manager:    'صلاحية كاملة',
  supervisor: 'مشرف الشيفت',
  cashier:    'كاشير'
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  pos:               'نقطة البيع',
  order_history:     'سجل الطلبات',
  cashier_inventory: 'توريد ومصروفات',
  view_reports:      'التقارير والملخصات',
  manage_shifts:     'إدارة الشيفتات',
  manage_menu:       'الأصناف والقائمة',
  manage_purchases:  'المشتريات والمخزون',
  manage_suppliers:  'الموردين',
  manage_accounts:   'إدارة الحسابات',
  manage_settings:   'إعدادات المطعم'
}

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  pos:               'فتح شاشة البيع وتسجيل الطلبات',
  order_history:     'عرض وإلغاء ودفع الطلبات السابقة',
  cashier_inventory: 'تسجيل مشتريات ومصروفات من شاشة الكاشير',
  view_reports:      'عرض تقارير الإيرادات وملخصات الشيفتات',
  manage_shifts:     'فتح وإغلاق وأرشفة الشيفتات',
  manage_menu:       'إضافة وتعديل الأصناف والتصنيفات والوصفات',
  manage_purchases:  'إدارة المخزون والمكوّنات وتسجيل الشراء',
  manage_suppliers:  'إدارة بيانات الموردين والمعاملات',
  manage_accounts:   'إنشاء وتعديل وحذف حسابات المستخدمين',
  manage_settings:   'تعديل اسم المطعم والعملة والألوان والترابيزات'
}

export const POS_PERMISSIONS: Permission[] = [
  'pos',
  'order_history',
  'cashier_inventory'
]

export const MANAGEMENT_PERMISSIONS: Permission[] = [
  'view_reports',
  'manage_shifts',
  'manage_menu',
  'manage_purchases',
  'manage_suppliers',
  'manage_accounts',
  'manage_settings'
]

/** Permission groups for UI display */
export const PERMISSION_GROUPS: { label: string; perms: Permission[] }[] = [
  {
    label: 'عمليات البيع',
    perms: ['pos', 'order_history', 'cashier_inventory']
  },
  {
    label: 'الإشراف والتقارير',
    perms: ['view_reports', 'manage_shifts']
  },
  {
    label: 'إدارة المخزون',
    perms: ['manage_purchases', 'manage_suppliers']
  },
  {
    label: 'إدارة النظام',
    perms: ['manage_menu', 'manage_accounts', 'manage_settings']
  }
]

/**
 * Returns true if the user has the given permission.
 * Checks user.permissions first; falls back to role preset for manager.
 */
export function hasPermission(user: AppUser | null, permission: Permission): boolean {
  if (!user) return false
  // Manager always has full access regardless of permissions array
  if (user.role === 'manager') return true
  // Otherwise check the stored permissions array
  const perms = user.permissions ?? ROLE_PRESET_PERMISSIONS[user.role] ?? []
  return perms.includes(permission)
}

export function hasAnyPermission(user: AppUser | null, permissions: Permission[]): boolean {
  return permissions.some((permission) => hasPermission(user, permission))
}

/** Get the effective permission list for a user */
export function getUserPermissions(user: AppUser): Permission[] {
  if (user.role === 'manager') return ROLE_PRESET_PERMISSIONS.manager
  return user.permissions ?? ROLE_PRESET_PERMISSIONS[user.role] ?? []
}

/** Convert a username to the app's internal email-shaped identifier. */
export function usernameToEmail(username: string): string {
  return `${username.toLowerCase().trim()}@abdokofta.local`
}

// Kept for backwards compat
export const getRolePermissions = (role: UserRole): Permission[] =>
  ROLE_PRESET_PERMISSIONS[role] ?? []
