import type { IconType } from 'react-icons'
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
  { to: '/pos',           label: 'نقطة البيع',          hint: 'إنشاء طلبات وبيع',           icon: MdPointOfSale, iconKey: 'MdPointOfSale' },
  { to: '/pos/inventory', label: 'توريد ومصروفات',       hint: 'مخزون ومصاريف الدرج',        icon: MdInventory,   iconKey: 'MdInventory' },
  { to: '/pos/history',   label: 'سجل الطلبات',          hint: 'عرض وإلغاء الطلبات',         icon: MdHistory,     iconKey: 'MdHistory' }
]

// Supervisor: uses /supervisor/ prefix to avoid route conflicts with manager
export const SUPERVISOR_NAV: NavItem[] = [
  { to: '/pos',                  label: 'نقطة البيع',          hint: 'إنشاء طلبات وبيع',           icon: MdPointOfSale,  iconKey: 'MdPointOfSale' },
  { to: '/pos/inventory',        label: 'توريد ومصروفات',       hint: 'مخزون ومصاريف الدرج',        icon: MdInventory,    iconKey: 'MdInventory' },
  { to: '/pos/history',          label: 'سجل الطلبات',          hint: 'عرض وإلغاء الطلبات',         icon: MdHistory,      iconKey: 'MdHistory' },
  { to: '/supervisor/shifts',    label: 'الشيفتات',             hint: 'مراجعة وتقفيل وأرشفة',       icon: MdWorkHistory,  iconKey: 'MdWorkHistory' },
  { to: '/supervisor/purchases', label: 'المشتريات',            hint: 'مخزون وشراء وهدر',           icon: MdShoppingCart, iconKey: 'MdShoppingCart' },
  { to: '/supervisor/suppliers', label: 'الموردين',             hint: 'حسابات وتوريدات الموردين',   icon: MdPersonSearch, iconKey: 'MdPersonSearch' },
  { to: '/supervisor/reports',   label: 'التقارير',             hint: 'إيرادات وملخصات',            icon: MdBarChart,     iconKey: 'MdBarChart' }
]

// Manager: full access under /manager/
export const MANAGER_NAV: NavItem[] = [
  { to: '/manager',                 label: 'لوحة التحكم',   hint: 'ملخص اليوم والوصول السريع',  icon: MdDashboard,    iconKey: 'MdDashboard',   end: true },
  { to: '/manager/items',           label: 'الأصناف',       hint: 'القائمة والتصنيفات والوصفات', icon: MdMenuBook,     iconKey: 'MdMenuBook' },
  { to: '/manager/tables',          label: 'الترابيزات',    hint: 'تخطيط الصالة والمناطق',      icon: MdTableBar,     iconKey: 'MdTableBar' },
  { to: '/manager/purchases',       label: 'المشتريات',     hint: 'مخزون وشراء وهدر',           icon: MdShoppingCart, iconKey: 'MdShoppingCart' },
  { to: '/manager/cashiers',        label: 'الحسابات',      hint: 'المستخدمون والصلاحيات',      icon: MdPeople,       iconKey: 'MdPeople' },
  { to: '/manager/shifts',          label: 'الشيفتات',      hint: 'مراجعة وتقفيل وأرشفة',       icon: MdWorkHistory,  iconKey: 'MdWorkHistory' },
  { to: '/manager/suppliers',       label: 'الموردين',      hint: 'حسابات وتوريدات الموردين',   icon: MdPersonSearch, iconKey: 'MdPersonSearch' },
  { to: '/manager/cashier-history', label: 'سجل الكاشيرات', hint: 'أورردرات الكاشير اليومية',   icon: MdHistory,      iconKey: 'MdHistory' },
  { to: '/manager/reports',         label: 'التقارير',      hint: 'إيرادات وملخصات',            icon: MdBarChart,     iconKey: 'MdBarChart' },
  { to: '/manager/audit',           label: 'سجل الأحداث',   hint: 'مراقبة وتدقيق العمليات',     icon: MdSecurity,     iconKey: 'MdSecurity' },
  { to: '/manager/settings',        label: 'الإعدادات',     hint: 'اسم المطعم والعملة',          icon: MdSettings,     iconKey: 'MdSettings' }
]

export function navLinkEnd(item: NavItem): boolean {
  return item.end ?? (item.to === '/manager' || item.to === '/pos')
}