import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, Outlet } from 'react-router-dom'
import { useAuthBootstrap } from '@renderer/features/auth/use-auth-bootstrap'
import { useSyncListener } from '@renderer/features/sync/use-sync-listener'
import { SyncProgressNotification } from '@renderer/features/sync/SyncProgressNotification'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { ProtectedRoute } from '@renderer/features/auth/ProtectedRoute'
import { AppShell } from '@renderer/components/layout/AppShell'
import { PageLoader } from '@renderer/components/PageLoader'
import { UpdateNotification, useUpdaterBootstrap } from '@renderer/components/UpdateNotification'
import { WhatsNewModal, useWhatsNewBootstrap } from '@renderer/components/WhatsNewModal'
import { PinLockScreen } from '@renderer/components/PinLockScreen'
import { usePinBootstrap } from '@renderer/features/auth/use-pin-bootstrap'
import { applyThemeColor } from '@renderer/features/theme/theme-store'
import { getSettings } from '@renderer/features/orders/order-service'
import { CASHIER_NAV, MANAGER_NAV, SUPERVISOR_NAV } from '@renderer/config/navigation'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useArrowFocusNavigation } from '@renderer/features/accessibility/use-arrow-focus-navigation'

const LoginPage = lazy(() =>
  import('@renderer/features/auth/LoginPage').then((m) => ({ default: m.LoginPage }))
)
const PosPage = lazy(() =>
  import('@renderer/features/pos/PosPage').then((m) => ({ default: m.PosPage }))
)
const OrderHistoryPage = lazy(() =>
  import('@renderer/features/pos/OrderHistoryPage').then((m) => ({
    default: m.OrderHistoryPage
  }))
)
const CashierInventoryPage = lazy(() =>
  import('@renderer/features/pos/CashierInventoryPage').then((m) => ({
    default: m.CashierInventoryPage
  }))
)
const ManagerDashboard = lazy(() =>
  import('@renderer/features/manager/ManagerDashboard').then((m) => ({
    default: m.ManagerDashboard
  }))
)
const ItemsPage = lazy(() =>
  import('@renderer/features/manager/ItemsPage').then((m) => ({ default: m.ItemsPage }))
)
const PurchasesPage = lazy(() =>
  import('@renderer/features/manager/PurchasesPage').then((m) => ({ default: m.PurchasesPage }))
)
const AccountsPage = lazy(() =>
  import('@renderer/features/manager/AccountsPage').then((m) => ({ default: m.AccountsPage }))
)
const ShiftsPage = lazy(() =>
  import('@renderer/features/manager/ShiftsPage').then((m) => ({
    default: m.ShiftsPage
  }))
)
const SuppliersPage = lazy(() =>
  import('@renderer/features/manager/SuppliersPage').then((m) => ({
    default: m.SuppliersPage
  }))
)
const ReportsPage = lazy(() =>
  import('@renderer/features/manager/ReportsPage').then((m) => ({
    default: m.ReportsPage
  }))
)
const SettingsPage = lazy(() =>
  import('@renderer/features/manager/SettingsPage').then((m) => ({
    default: m.SettingsPage
  }))
)
const CashierHistoryPage = lazy(() =>
  import('@renderer/features/manager/CashierHistoryPage').then((m) => ({
    default: m.CashierHistoryPage
  }))
)

const AuditLogPage = lazy(() =>
  import('@renderer/features/manager/AuditLogPage').then((m) => ({
    default: m.AuditLogPage
  }))
)

const FloorPlanPage = lazy(() =>
  import('@renderer/features/manager/FloorPlanPage').then((m) => ({
    default: m.FloorPlanPage
  }))
)

function CashierLayout(): React.ReactElement {
  return (
    <AppShell nav={CASHIER_NAV}>
      <Outlet />
    </AppShell>
  )
}

function SupervisorLayout(): React.ReactElement {
  return (
    <AppShell nav={SUPERVISOR_NAV}>
      <Outlet />
    </AppShell>
  )
}

function ManagerLayout(): React.ReactElement {
  return (
    <AppShell nav={MANAGER_NAV}>
      <Outlet />
    </AppShell>
  )
}

function RootRedirect(): React.ReactElement {
  const user = useAuthStore((s) => s.user)
  const loading = useAuthStore((s) => s.loading)
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'manager') return <Navigate to="/manager" replace />
  return <Navigate to="/pos" replace />
}

function LazyPage({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </ErrorBoundary>
  )
}

type SideNetworkStatus = {
  mode?: string
  connected?: boolean
  side?: {
    masterUrl?: string
    deviceName?: string
  }
  error?: string
}

export default function App(): React.ReactElement {
  const [sideNetwork, setSideNetwork] = useState<SideNetworkStatus | null>(null)
  const [repairMasterUrl, setRepairMasterUrl] = useState('')
  const [repairDeviceName, setRepairDeviceName] = useState('')
  const [repairPairingCode, setRepairPairingCode] = useState('')
  const [repairBusy, setRepairBusy] = useState(false)
  const [repairMessage, setRepairMessage] = useState<string | null>(null)
  useAuthBootstrap()
  useSyncListener()
  useUpdaterBootstrap()
  useWhatsNewBootstrap()
  usePinBootstrap()
  useArrowFocusNavigation()

  useEffect(() => {
    void getSettings().then((s) => {
      if (s.primaryColor) applyThemeColor(s.primaryColor)
    })
  }, [])

  const refreshSideNetwork = useCallback(async (): Promise<void> => {
    const status = await window.electronAPI.getNetworkStatus().catch(() => null) as SideNetworkStatus | null
    const disconnected = status?.mode === 'side' && status.connected === false
    if (!disconnected) {
      setSideNetwork(null)
      return
    }
    setSideNetwork(status)
    setRepairMasterUrl((current) => current || status.side?.masterUrl || '')
    setRepairDeviceName((current) => current || status.side?.deviceName || `POS-${Math.floor(Math.random() * 900 + 100)}`)
  }, [])

  useEffect(() => {
    let disposed = false
    async function checkNetwork(): Promise<void> {
      if (!disposed) await refreshSideNetwork()
    }
    void checkNetwork()
    const timer = window.setInterval(() => { void checkNetwork() }, 5000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [refreshSideNetwork])

  async function repairSidePairing(): Promise<void> {
    setRepairBusy(true)
    setRepairMessage(null)
    try {
      const result = await window.electronAPI.pairSideDevice({
        masterUrl: repairMasterUrl,
        deviceName: repairDeviceName || 'Side device',
        code: repairPairingCode
      })
      if (!result.ok) {
        setRepairMessage(result.error ?? 'فشل إعادة ربط الجهاز بالماستر')
        return
      }
      setRepairPairingCode('')
      setRepairMessage('تم إعادة الربط بالماستر')
      await refreshSideNetwork()
    } finally {
      setRepairBusy(false)
    }
  }

  async function clearSidePairingAndRestart(): Promise<void> {
    setRepairBusy(true)
    try {
      await window.electronAPI.clearSideConnection()
      window.location.reload()
    } finally {
      setRepairBusy(false)
    }
  }

  return (
    <HashRouter>
      <PinLockScreen />
      <UpdateNotification />
      <WhatsNewModal />
      <SyncProgressNotification />
      {sideNetwork && (
        <div className="modal-overlay" style={{ zIndex: 99998 }}>
          <div className="modal" style={{ maxWidth: 520 }}>
            <h2 className="order-details__title">الاتصال بالماستر غير صالح</h2>
            <p className="muted">
              إذا تم فصل هذا الجهاز من الماستر، اطلب من المدير إنشاء كود ربط جديد ثم أعد ربط الجهاز من هنا.
            </p>
            {sideNetwork.error && <p className="form-message form-message--error">{sideNetwork.error}</p>}
            {repairMessage && <p className={`form-message ${repairMessage.includes('فشل') ? 'form-message--error' : 'form-message--ok'}`}>{repairMessage}</p>}
            <div className="settings-form-grid" style={{ marginTop: 12, textAlign: 'right' }}>
              <label className="field">
                <span>عنوان الماستر</span>
                <input dir="ltr" value={repairMasterUrl} onChange={(e) => setRepairMasterUrl(e.target.value)} placeholder="http://192.168.1.10:47831" />
              </label>
              <label className="field">
                <span>اسم هذا الجهاز</span>
                <input value={repairDeviceName} onChange={(e) => setRepairDeviceName(e.target.value)} />
              </label>
              <label className="field">
                <span>كود الربط الجديد</span>
                <input dir="ltr" value={repairPairingCode} onChange={(e) => setRepairPairingCode(e.target.value)} placeholder="123456" />
              </label>
            </div>
            <div className="form-actions" style={{ justifyContent: 'center', marginTop: 14 }}>
              <button type="button" className="btn btn--primary" disabled={repairBusy || !repairMasterUrl || !repairPairingCode} onClick={() => void repairSidePairing()}>
                إعادة الربط
              </button>
              <button type="button" className="btn btn--secondary" disabled={repairBusy} onClick={() => void refreshSideNetwork()}>
                إعادة المحاولة
              </button>
              <button type="button" className="btn btn--danger" disabled={repairBusy} onClick={() => void clearSidePairingAndRestart()}>
                إلغاء ربط هذا الجهاز
              </button>
            </div>
          </div>
        </div>
      )}
      <Routes>
        <Route
          path="/login"
          element={
            <LazyPage>
              <LoginPage />
            </LazyPage>
          }
        />
        <Route path="/" element={<RootRedirect />} />

        <Route element={<ProtectedRoute roles={['cashier']} />}>
          <Route element={<CashierLayout />}>
            <Route path="/pos" element={<LazyPage><PosPage /></LazyPage>} />
            <Route path="/pos/history" element={<LazyPage><OrderHistoryPage /></LazyPage>} />
            <Route path="/pos/inventory" element={<LazyPage><CashierInventoryPage /></LazyPage>} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute roles={['supervisor']} />}>
          <Route element={<SupervisorLayout />}>
            <Route path="/supervisor/pos" element={<LazyPage><PosPage /></LazyPage>} />
            <Route path="/supervisor/history" element={<LazyPage><OrderHistoryPage /></LazyPage>} />
            <Route path="/supervisor/inventory" element={<LazyPage><CashierInventoryPage /></LazyPage>} />
            <Route path="/supervisor/shifts" element={<LazyPage><ShiftsPage /></LazyPage>} />
            <Route path="/supervisor/purchases" element={<LazyPage><PurchasesPage /></LazyPage>} />
            <Route path="/supervisor/suppliers" element={<LazyPage><SuppliersPage /></LazyPage>} />
            <Route path="/supervisor/reports" element={<LazyPage><ReportsPage /></LazyPage>} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute roles={['manager']} />}>
          <Route element={<ManagerLayout />}>
            <Route
              path="/manager"
              element={
                <LazyPage>
                  <ManagerDashboard />
                </LazyPage>
              }
            />
            <Route
              path="/manager/items"
              element={
                <LazyPage>
                  <ItemsPage />
                </LazyPage>
              }
            />
            <Route
              path="/manager/purchases"
              element={
                <LazyPage>
                  <PurchasesPage />
                </LazyPage>
              }
            />
            <Route
              path="/manager/cashiers"
              element={
                <LazyPage>
                  <AccountsPage />
                </LazyPage>
              }
            />
            <Route
              path="/manager/shifts"
              element={
                <LazyPage>
                  <ShiftsPage />
                </LazyPage>
              }
            />
            <Route
              path="/manager/suppliers"
              element={
                <LazyPage>
                  <SuppliersPage />
                </LazyPage>
              }
            />
            <Route
              path="/manager/reports"
              element={
                <LazyPage>
                  <ReportsPage />
                </LazyPage>
              }
            />
            <Route
              path="/manager/settings"
              element={
                <LazyPage>
                  <SettingsPage />
                </LazyPage>
              }
            />
            <Route
              path="/manager/cashier-history"
              element={
                <LazyPage>
                  <CashierHistoryPage />
                </LazyPage>
              }
            />
            <Route
              path="/manager/audit"
              element={
                <LazyPage>
                  <AuditLogPage />
                </LazyPage>
              }
            />
            <Route
              path="/manager/tables"
              element={
                <LazyPage>
                  <FloorPlanPage />
                </LazyPage>
              }
            />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
