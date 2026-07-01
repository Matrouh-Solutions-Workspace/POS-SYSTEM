import type { IconType } from 'react-icons'
import type { AppUser, Permission } from '@shared/types'
import { MANAGEMENT_PERMISSIONS, hasAnyPermission, hasPermission } from '@shared/types/user'
import {
  MdPointOfSale,
  MdHistory,
  MdDashboard,
  MdInventory,
  MdMenuBook,
  MdPeople,
  MdBarChart,
  MdSettings,
  MdLogout,
  MdPersonSearch,
  MdWorkHistory,
  MdShoppingCart,
  MdSecurity,
  MdTableBar
} from 'react-icons/md'

export { MdLogout }

export interface NavSubItem {
  to: string
  label: string
}

export interface NavItem {
  to: string
  label: string
  hint?: string
  icon: IconType
  iconKey: string
  permission?: Permission
  anyPermission?: Permission[]
  end?: boolean
  children?: NavSubItem[]
}

export const NAV_ICON_MAP: Record<string, IconType> = {
  MdPointOfSale,
  MdHistory,
  MdDashboard,
  MdInventory,
  MdMenuBook,
  MdPeople,
  MdBarChart,
  MdSettings,
  MdPersonSearch,
  MdWorkHistory,
  MdShoppingCart,
  MdSecurity,
  MdTableBar
}

// Cashier: only POS routes
export const CASHIER_NAV: NavItem[] = [
  { to: '/pos',           label: 'نقطة البيع',          hint: 'إنشاء طلبات وبيع',           icon: MdPointOfSale, iconKey: 'MdPointOfSale', permission: 'pos' },
  { to: '/pos/inventory', label: 'توريد ومصروفات',       hint: 'مخزون ومصاريف الدرج',        icon: MdInventory,   iconKey: 'MdInventory',   permission: 'cashier_inventory' },
  { to: '/pos/history',   label: 'سجل الطلبات',          hint: 'عرض وإلغاء الطلبات',         icon: MdHistory,     iconKey: 'MdHistory',     permission: 'order_history' }
]

// Supervisor: uses /supervisor/ prefix to avoid route conflicts with manager
export const SUPERVISOR_NAV: NavItem[] = [
  { to: '/pos',                  label: 'نقطة البيع',          hint: 'إنشاء طلبات وبيع',           icon: MdPointOfSale,  iconKey: 'MdPointOfSale', permission: 'pos' },
  { to: '/pos/inventory',        label: 'توريد ومصروفات',       hint: 'مخزون ومصاريف الدرج',        icon: MdInventory,    iconKey: 'MdInventory',   permission: 'cashier_inventory' },
  { to: '/pos/history',          label: 'سجل الطلبات',          hint: 'عرض وإلغاء الطلبات',         icon: MdHistory,      iconKey: 'MdHistory',     permission: 'order_history' },
  { to: '/supervisor/shifts',    label: 'الشيفتات',             hint: 'مراجعة وتقفيل وأرشفة',       icon: MdWorkHistory,  iconKey: 'MdWorkHistory',  permission: 'manage_shifts' },
  { to: '/supervisor/purchases', label: 'المشتريات',            hint: 'مخزون وشراء وهدر',           icon: MdShoppingCart, iconKey: 'MdShoppingCart', permission: 'manage_purchases' },
  { to: '/supervisor/suppliers', label: 'الموردين',             hint: 'حسابات وتوريدات الموردين',   icon: MdPersonSearch, iconKey: 'MdPersonSearch', permission: 'manage_suppliers' },
  { to: '/supervisor/reports',   label: 'التقارير',             hint: 'إيرادات وملخصات',            icon: MdBarChart,     iconKey: 'MdBarChart',     permission: 'view_reports' }
]

// Manager: full access under /manager/
export const MANAGER_NAV: NavItem[] = [
  { to: '/manager',                 label: 'لوحة التحكم',   hint: 'ملخص اليوم والوصول السريع',  icon: MdDashboard,    iconKey: 'MdDashboard',   end: true, anyPermission: MANAGEMENT_PERMISSIONS },
  { to: '/manager/items',           label: 'الأصناف',       hint: 'القائمة والتصنيفات والوصفات', icon: MdMenuBook,     iconKey: 'MdMenuBook',     permission: 'manage_menu' },
  { to: '/manager/tables',          label: 'الترابيزات',    hint: 'تخطيط الصالة والمناطق',      icon: MdTableBar,     iconKey: 'MdTableBar',     permission: 'manage_settings' },
  { to: '/manager/purchases',       label: 'المشتريات',     hint: 'مخزون وشراء وهدر',           icon: MdShoppingCart, iconKey: 'MdShoppingCart', permission: 'manage_purchases' },
  { to: '/manager/cashiers',        label: 'الحسابات',      hint: 'المستخدمون والصلاحيات',      icon: MdPeople,       iconKey: 'MdPeople',       permission: 'manage_accounts' },
  { to: '/manager/shifts',          label: 'الشيفتات',      hint: 'مراجعة وتقفيل وأرشفة',       icon: MdWorkHistory,  iconKey: 'MdWorkHistory',  permission: 'manage_shifts' },
  { to: '/manager/suppliers',       label: 'الموردين',      hint: 'حسابات وتوريدات الموردين',   icon: MdPersonSearch, iconKey: 'MdPersonSearch', permission: 'manage_suppliers' },
  { to: '/manager/contacts',        label: 'عملاء الدليفري', hint: 'أرقام وعناوين عملاء التوصيل', icon: MdPersonSearch, iconKey: 'MdPersonSearch', permission: 'manage_settings' },
  { to: '/manager/cashier-history', label: 'سجل الكاشيرات', hint: 'أورردرات الكاشير اليومية',   icon: MdHistory,      iconKey: 'MdHistory',      anyPermission: ['order_history', 'view_reports'] },
  { to: '/manager/reports',         label: 'التقارير',      hint: 'إيرادات وملخصات',            icon: MdBarChart,     iconKey: 'MdBarChart',     permission: 'view_reports' },
  { to: '/manager/audit',           label: 'سجل الأحداث',   hint: 'مراقبة وتدقيق العمليات',     icon: MdSecurity,     iconKey: 'MdSecurity',     permission: 'manage_settings' },
  { to: '/manager/settings',        label: 'الإعدادات',     hint: 'اسم المطعم والعملة',          icon: MdSettings,     iconKey: 'MdSettings',     permission: 'manage_settings' }
]

export function navLinkEnd(item: NavItem): boolean {
  return item.end ?? (item.to === '/manager' || item.to === '/pos')
}

export function canShowNavItem(user: AppUser, item: NavItem): boolean {
  if (item.permission) return hasPermission(user, item.permission)
  if (item.anyPermission) return hasAnyPermission(user, item.anyPermission)
  return true
}

export function buildPosNavForUser(user: AppUser): NavItem[] {
  return CASHIER_NAV.filter((item) => canShowNavItem(user, item))
}

export function buildManagerNavForUser(user: AppUser): NavItem[] {
  return MANAGER_NAV.filter((item) => canShowNavItem(user, item))
}

export function buildSupervisorNavForUser(user: AppUser): NavItem[] {
  return SUPERVISOR_NAV.filter((item) => canShowNavItem(user, item))
}

export function buildNavForUser(user: AppUser, mode: 'pos' | 'manager'): NavItem[] {
  return mode === 'pos' ? buildPosNavForUser(user) : buildManagerNavForUser(user)
}

export function hasManagerModeAccess(user: AppUser | null): boolean {
  return hasAnyPermission(user, MANAGEMENT_PERMISSIONS)
}

export function defaultManagerPathForUser(user: AppUser): string {
  return buildManagerNavForUser(user)[0]?.to ?? '/pos'
}
