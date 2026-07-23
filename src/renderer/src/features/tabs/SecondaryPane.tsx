/**
 * SecondaryPane — renders a page component directly by path,
 * without any router. Pages receive no route params so they
 * rely only on their own state/data fetching (which they all do).
 *
 * No MemoryRouter, no nested Router — solves the invariant error.
 */
import { Suspense, lazy, memo } from 'react'
import { PageLoader } from '@renderer/components/PageLoader'

const PosPage              = lazy(() => import('@renderer/features/pos/PosPage').then((m) => ({ default: m.PosPage })))
const OrderHistoryPage     = lazy(() => import('@renderer/features/pos/OrderHistoryPage').then((m) => ({ default: m.OrderHistoryPage })))
const CashierInventoryPage = lazy(() => import('@renderer/features/pos/CashierInventoryPage').then((m) => ({ default: m.CashierInventoryPage })))
const ManagerDashboard     = lazy(() => import('@renderer/features/manager/ManagerDashboard').then((m) => ({ default: m.ManagerDashboard })))
const ItemsPage      = lazy(() => import('@renderer/features/manager/ItemsPage').then((m) => ({ default: m.ItemsPage })))
const PurchasesPage  = lazy(() => import('@renderer/features/manager/PurchasesPage').then((m) => ({ default: m.PurchasesPage })))
const AccountsPage         = lazy(() => import('@renderer/features/manager/AccountsPage').then((m) => ({ default: m.AccountsPage })))
const ShiftsPage           = lazy(() => import('@renderer/features/manager/ShiftsPage').then((m) => ({ default: m.ShiftsPage })))
const SuppliersPage        = lazy(() => import('@renderer/features/manager/SuppliersPage').then((m) => ({ default: m.SuppliersPage })))
const ContactsPage         = lazy(() => import('@renderer/features/manager/ContactsPage').then((m) => ({ default: m.ContactsPage })))
const ReportsPage          = lazy(() => import('@renderer/features/manager/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const SettingsPage         = lazy(() => import('@renderer/features/manager/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const CashierHistoryPage   = lazy(() => import('@renderer/features/manager/CashierHistoryPage').then((m) => ({ default: m.CashierHistoryPage })))

const PAGE_MAP: Record<string, React.ComponentType> = {
  '/pos':                     PosPage,
  '/pos/history':             OrderHistoryPage,
  '/pos/inventory':           CashierInventoryPage,
  '/manager':                 ManagerDashboard,
  '/manager/items':           ItemsPage,
  '/manager/purchases':       PurchasesPage,
  '/manager/cashiers':        AccountsPage,
  '/manager/shifts':          ShiftsPage,
  '/manager/suppliers':       SuppliersPage,
  '/manager/contacts':        ContactsPage,
  '/manager/reports':         ReportsPage,
  '/manager/settings':        SettingsPage,
  '/manager/cashier-history': CashierHistoryPage,
}

interface SecondaryPaneProps {
  path: string
}

export const SecondaryPane = memo(function SecondaryPane({ path }: SecondaryPaneProps): React.ReactElement {
  const Component = PAGE_MAP[path]
  if (!Component) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-muted)' }}>
        الصفحة غير موجودة
      </div>
    )
  }
  return (
    <Suspense fallback={<PageLoader />}>
      <Component />
    </Suspense>
  )
})
