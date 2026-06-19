import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { logoutUser } from '@renderer/features/auth/auth-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { SyncStatusBadge } from '@renderer/features/sync/SyncStatusBadge'
import { MdLogout, type NavItem } from '@renderer/config/navigation'
import {
  MdSystemUpdate, MdClose, MdExpandMore, MdExpandLess,
  MdLock, MdNewReleases, MdChevronLeft, MdChevronRight, MdPointOfSale, MdDashboard
} from 'react-icons/md'
import { triggerCheckNow, useUpdateState } from '@renderer/components/UpdateNotification'
import { openWhatsNew } from '@renderer/components/WhatsNewModal'
import { usePinStore } from '@renderer/features/auth/pin-store'
import { getUnarchivedShiftCount } from '@renderer/features/shifts/shift-service'
import { getSettings } from '@renderer/features/orders/order-service'
import { RESTAURANT_NAME_AR } from '@shared/constants/branding'
import { SplitView, initSplitStore } from '@renderer/features/tabs/SplitView'
import { useSplitStore, mkTabId } from '@renderer/features/tabs/split-store'
import { useGlobalKeyboardShortcuts } from '@renderer/features/keyboard/use-keyboard-shortcuts'
import { useTabShortcuts } from '@renderer/features/keyboard/use-tab-shortcuts'
import { useKeyboardStore } from '@renderer/features/keyboard/keyboard-store'
import { hasPermission } from '@shared/types/user'
import { defaultManagerPathForUser, hasManagerModeAccess } from '@renderer/config/navigation'

const SIDEBAR_COLLAPSE_PREF_KEY = 'abdokofta.sidebarCollapsePreference'
type SidebarCollapsePreference = 'expanded' | 'collapsed'

interface AppShellProps {
  nav: NavItem[]
  children: React.ReactNode
}

export function AppShell({ nav, children }: AppShellProps): React.ReactElement {
  const displayName = useAuthStore((s) => s.user?.displayName)
  const userRole = useAuthStore((s) => s.user?.role)
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const location = useLocation()
  const [currentVersion, setCurrentVersion] = useState<string>('...')
  const [showPopup, setShowPopup] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [shiftBadge, setShiftBadge] = useState(0)
  const [brandName, setBrandName] = useState(RESTAURANT_NAME_AR)
  const updateState = useUpdateState()
  const pinEnabled = usePinStore((s) => s.pinEnabled)
  const lockApp = usePinStore((s) => s.lock)

  const panes = useSplitStore((s) => s.panes)
  const focusedPaneId = useSplitStore((s) => s.focusedPaneId)

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useGlobalKeyboardShortcuts()
  useTabShortcuts()

  // Load persisted shortcut chords from settings on mount
  useEffect(() => {
    void getSettings().then((s) => {
      useKeyboardStore.getState().loadChords(s.keyboardShortcuts)
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Sidebar collapse ──────────────────────────────────────────────────────
  const isSplitActive = panes.length >= 2

  const [sidebarCollapsePreference, setSidebarCollapsePreference] = useState<SidebarCollapsePreference | null>(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_COLLAPSE_PREF_KEY)
      return stored === 'expanded' || stored === 'collapsed' ? stored : null
    } catch {
      return null
    }
  })

  // Default behavior is still the same in split mode:
  // if no explicit preference is saved, split view starts collapsed.
  const sidebarCollapsed =
    sidebarCollapsePreference === 'collapsed' ||
    (sidebarCollapsePreference !== 'expanded' && isSplitActive)

  function toggleSidebarCollapse(): void {
    const nextPreference: SidebarCollapsePreference = sidebarCollapsed ? 'expanded' : 'collapsed'
    setSidebarCollapsePreference(nextPreference)
    try {
      localStorage.setItem(SIDEBAR_COLLAPSE_PREF_KEY, nextPreference)
    } catch {
      /* ignore */
    }
  }

  // Build a flat map of path → nav item for tab sync
  const allNavItems = nav.flatMap((item) =>
    item.children
      ? item.children.map((c) => ({ to: c.to, label: c.label, iconKey: item.iconKey }))
      : [{ to: item.to, label: item.label, iconKey: item.iconKey }]
  )

  function findNavItem(path: string) {
    // Exact match first
    const exact = allNavItems.find((item) => item.to === path)
    if (exact) return exact
    // Then prefix match — but only if the nav item path is longer than just '/manager'
    // to avoid '/manager' swallowing all '/manager/...' routes
    return allNavItems.find(
      (item) => item.to !== '/manager' && path.startsWith(item.to + '/')
    ) ?? allNavItems.find((item) => item.to === '/manager' && path.startsWith('/manager'))
  }

  // Initialize split store synchronously on first render if empty
  // (useEffect is too late — causes a flash with no tab bar)
  const storeState = useSplitStore.getState()
  if (storeState.panes.length === 0) {
    const matched = findNavItem(location.pathname) ?? allNavItems[0]
    if (matched) {
      initSplitStore({ id: mkTabId(), path: matched.to, label: matched.label, iconKey: matched.iconKey ?? 'MdDashboard' })
    }
  }

  // KEY FIX: whenever the router location changes, sync the primary pane's
  // active tab to match. This makes the router the single source of truth.
  useEffect(() => {
    const state = useSplitStore.getState()
    const primaryPane = state.panes[0]
    if (!primaryPane) return

    const matched = findNavItem(location.pathname)
    if (!matched) return

    // Check if a tab for this path already exists in the primary pane
    const existing = primaryPane.tabs.find((t) => t.path === matched.to)
    if (existing) {
      if (primaryPane.activeTabId !== existing.id) {
        state.activateTab(primaryPane.id, existing.id)
      }
    } else {
      state.openInFocused({ path: matched.to, label: matched.label, iconKey: matched.iconKey ?? 'MdDashboard' }, mkTabId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  useEffect(() => {
    window.electronAPI?.getAppVersion().then(setCurrentVersion).catch(() => {})
  }, [])

  useEffect(() => {
    void getSettings().then((s) => {
      if (s.restaurantNameAr) setBrandName(s.restaurantNameAr)
    }).catch(() => {})
  }, [location.pathname])

  useEffect(() => {
    void getUnarchivedShiftCount().then(setShiftBadge).catch(() => {})
  }, [location.pathname])

  useEffect(() => {
    for (const item of nav) {
      if (item.children?.some((c) => location.pathname === c.to || location.pathname.startsWith(c.to + '/'))) {
        setOpenDropdown(item.to)
        return
      }
    }
  }, [location.pathname, nav])

  function handleNavClick(item: { to: string; label: string; iconKey: string }): void {
    // Just navigate — the location sync effect will open/activate the tab automatically
    navigate(item.to)
  }

  function handleNavigatePrimary(path: string): void {
    navigate(path)
  }

  function handleNavigateSecondary(_path: string): void {
    // secondary pane renders by path from store — no router needed
  }

  async function handleLogout(): Promise<void> {
    const user = useAuthStore.getState().user
    await logoutUser(user ? { id: user.id, displayName: user.displayName, username: user.username } : undefined)
    // Clear tab state so the next user doesn't see the previous user's tabs
    useSplitStore.getState().reset()
    useAuthStore.getState().setUser(null)
    navigate('/login')
  }

  function handleCheckUpdate(): void {
    setShowPopup(true)
    triggerCheckNow()
  }

  const latestVersion =
    updateState.phase === 'uptodate'    ? updateState.latestVersion :
    updateState.phase === 'available'   ? updateState.version :
    updateState.phase === 'downloading' ? updateState.version :
    updateState.phase === 'ready'       ? updateState.version :
    null

  const isFlush = location.pathname === '/pos'
    || location.pathname === '/manager/purchases'
    || location.pathname === '/manager/items'
    || location.pathname === '/manager/cashiers'
    || location.pathname === '/manager/tables'
  const primaryPane = panes[0]
  // Use router location as source of truth for sidebar active state
  const focusedActivePath = location.pathname
  const canSwitchPosManager = Boolean(user && hasPermission(user, 'pos') && hasManagerModeAccess(user))
  const switchTarget = user && location.pathname.startsWith('/pos') ? defaultManagerPathForUser(user) : '/pos'
  const switchLabel = location.pathname.startsWith('/pos') ? 'لوحة التحكم' : 'واجهة البيع'
  const SwitchIcon = location.pathname.startsWith('/pos') ? MdDashboard : MdPointOfSale

  return (
    <div className="app-shell">
      {/* ── Sidebar ── */}
      <aside
        className={`app-sidebar${sidebarCollapsed ? ' app-sidebar--collapsed' : ''}`}
        aria-label="القائمة الرئيسية"
      >
        {/* Brand / toggle row */}
        <div className="app-sidebar__brand-row">
          {!sidebarCollapsed && (
            <span className="app-sidebar__brand-text">{brandName}</span>
          )}
          <button
            type="button"
            className="app-sidebar__toggle"
            onClick={toggleSidebarCollapse}
            title={sidebarCollapsed ? 'توسيع الشريط الجانبي' : 'طي الشريط الجانبي'}
            aria-label={sidebarCollapsed ? 'توسيع' : 'طي'}
          >
            {/* In RTL: chevron-right = expand (points inward), chevron-left = collapse */}
            {sidebarCollapsed ? <MdChevronLeft /> : <MdChevronRight />}
          </button>
        </div>

        <nav className="app-sidebar__nav">
          {nav.map((item) => {
            const Icon = item.icon

            if (item.children) {
              const isOpen = openDropdown === item.to && !sidebarCollapsed
              const isAnyChildActive = item.children.some(
                (c) => focusedActivePath === c.to
              )
              return (
                <div key={item.to} className="app-sidebar__dropdown">
                  <button
                    type="button"
                    className={`app-sidebar__link app-sidebar__dropdown-trigger${isAnyChildActive ? ' app-sidebar__link--active' : ''}`}
                    onClick={() => sidebarCollapsed ? undefined : setOpenDropdown(isOpen ? null : item.to)}
                    aria-expanded={isOpen}
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    <span className="app-sidebar__link-row">
                      <Icon className="app-sidebar__link-icon" aria-hidden="true" />
                      {!sidebarCollapsed && <span className="app-sidebar__link-label">{item.label}</span>}
                      {!sidebarCollapsed && (
                        <span className="app-sidebar__dropdown-arrow">
                          {isOpen ? <MdExpandLess /> : <MdExpandMore />}
                        </span>
                      )}
                    </span>
                    {!sidebarCollapsed && item.hint && <span className="app-sidebar__link-hint">{item.hint}</span>}
                  </button>

                  {isOpen && (
                    <div className="app-sidebar__dropdown-menu">
                      {item.children.map((child) => (
                        <button
                          key={child.to}
                          type="button"
                          className={`app-sidebar__dropdown-item${
                            focusedActivePath === child.to ? ' app-sidebar__dropdown-item--active' : ''
                          }`}
                          onClick={() => handleNavClick({ ...child, iconKey: item.iconKey })}
                        >
                          {child.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            }

            return (
              <button
                key={item.to}
                type="button"
                className={`app-sidebar__link${focusedActivePath === item.to ? ' app-sidebar__link--active' : ''}`}
                onClick={() => handleNavClick(item)}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <span className="app-sidebar__link-row">
                  <Icon className="app-sidebar__link-icon" aria-hidden="true" />
                  {!sidebarCollapsed && <span className="app-sidebar__link-label">{item.label}</span>}
                  {!sidebarCollapsed && item.to === '/manager/shifts' && shiftBadge > 0 && (
                    <span className="app-sidebar__badge">{shiftBadge}</span>
                  )}
                </span>
                {!sidebarCollapsed && item.hint && <span className="app-sidebar__link-hint">{item.hint}</span>}
                {/* Badge visible even when collapsed */}
                {sidebarCollapsed && item.to === '/manager/shifts' && shiftBadge > 0 && (
                  <span className="app-sidebar__badge app-sidebar__badge--collapsed">{shiftBadge}</span>
                )}
              </button>
            )
          })}
        </nav>

        <div className="app-sidebar__footer">
          {!sidebarCollapsed && <SyncStatusBadge />}
          {!sidebarCollapsed && displayName && (
            <span className="app-sidebar__user" title={displayName}>{displayName}</span>
          )}

          {!sidebarCollapsed && pinEnabled && userRole === 'cashier' && (
            <button type="button" className="btn btn--secondary btn--sm app-sidebar__lock-btn" onClick={lockApp}>
              <MdLock aria-hidden="true" /> قفل الشاشة
            </button>
          )}
          {!sidebarCollapsed && canSwitchPosManager && (
            <button type="button" className="btn btn--secondary btn--sm app-sidebar__switch-btn" onClick={() => navigate(switchTarget)}>
              <SwitchIcon aria-hidden="true" /> {switchLabel}
            </button>
          )}
          {sidebarCollapsed && pinEnabled && userRole === 'cashier' && (
            <button
              type="button"
              className="app-sidebar__icon-btn"
              onClick={lockApp}
              title="قفل الشاشة"
            >
              <MdLock />
            </button>
          )}
          {sidebarCollapsed && canSwitchPosManager && (
            <button
              type="button"
              className="app-sidebar__icon-btn"
              onClick={() => navigate(switchTarget)}
              title={switchLabel}
            >
              <SwitchIcon />
            </button>
          )}

          {!sidebarCollapsed && (
            <div className="app-sidebar__update-wrap">
              <button type="button" className="btn btn--secondary btn--sm app-sidebar__update-btn" onClick={handleCheckUpdate}>
                <MdSystemUpdate aria-hidden="true" /> تحديث
              </button>
              <button type="button" className="btn btn--secondary btn--sm app-sidebar__update-btn" onClick={openWhatsNew} title="ما الجديد في هذا الإصدار؟">
                <MdNewReleases aria-hidden="true" /> ما الجديد؟
              </button>

              {showPopup && (
                <div className="version-popup">
                  <button type="button" className="version-popup__close" onClick={() => setShowPopup(false)} aria-label="إغلاق"><MdClose /></button>
                  <div className="version-popup__row">
                    <span className="version-popup__label">الإصدار الحالي</span>
                    <span className="version-popup__value">v{currentVersion}</span>
                  </div>
                  <div className="version-popup__row">
                    <span className="version-popup__label">أحدث إصدار</span>
                    <span className="version-popup__value">
                      {updateState.phase === 'checking' && <span className="version-popup__checking">جارٍ التحقق…</span>}
                      {updateState.phase === 'error'    && <span className="version-popup__error">تعذّر التحقق</span>}
                      {latestVersion && <span className={updateState.phase === 'uptodate' ? 'version-popup__same' : 'version-popup__newer'}>v{latestVersion}</span>}
                      {updateState.phase === 'idle'     && <span className="version-popup__checking">جارٍ التحقق…</span>}
                    </span>
                  </div>
                  {updateState.phase === 'uptodate' && <div className="version-popup__status version-popup__status--ok">✓ التطبيق محدّث</div>}
                  {(updateState.phase === 'available' || updateState.phase === 'downloading' || updateState.phase === 'ready') && <div className="version-popup__status version-popup__status--new">↑ يتوفر تحديث جديد</div>}
                  {updateState.phase === 'error' && (
                    <div className="version-popup__status version-popup__status--err">
                      {typeof navigator !== 'undefined' && !navigator.onLine
                        ? '📶 لا يوجد اتصال بالإنترنت — تعذّر التحقق من التحديثات'
                        : (updateState.message.includes('getaddrinfo')
                            || updateState.message.includes('ENOTFOUND')
                            || updateState.message.includes('ENETUNREACH')
                            || updateState.message.includes('internet disconnected')
                            ? '📶 لا يوجد اتصال بالإنترنت — تعذّر التحقق من التحديثات'
                            : updateState.message || 'تعذّر التحقق من التحديثات'
                          )
                      }
                    </div>
                  )}
                  {updateState.phase === 'error' && (
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      style={{ marginTop: 6, width: '100%' }}
                      onClick={handleCheckUpdate}
                    >
                      إعادة المحاولة
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {sidebarCollapsed && (
            <button
              type="button"
              className="app-sidebar__icon-btn"
              onClick={handleCheckUpdate}
              title="تحديث"
            >
              <MdSystemUpdate />
            </button>
          )}

          <button
            type="button"
            className={sidebarCollapsed ? 'app-sidebar__icon-btn' : 'btn btn--secondary btn--sm app-sidebar__logout'}
            onClick={() => void handleLogout()}
            title={sidebarCollapsed ? 'خروج' : undefined}
          >
            <MdLogout aria-hidden="true" />
            {!sidebarCollapsed && ' خروج'}
          </button>
        </div>
      </aside>

      {/* ── Content area ── */}
      <div className="app-shell__content">
        {primaryPane && (
          <SplitView onNavigate={handleNavigatePrimary}>
            <main className={`app-main${isFlush ? ' app-main--flush' : ''}`}>
              {children}
            </main>
          </SplitView>
        )}
      </div>
    </div>
  )
}
