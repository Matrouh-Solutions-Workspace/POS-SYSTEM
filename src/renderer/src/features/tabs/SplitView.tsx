import { useRef, useCallback } from 'react'
import { MdClose } from 'react-icons/md'
import { useSplitStore, mkTabId } from './split-store'
import { TabBar } from './TabBar'
import { SecondaryPane } from './SecondaryPane'
import type { AppTab } from './tab-store'

interface SplitViewProps {
  /** Primary pane content (React Router Outlet) */
  children: React.ReactNode
  /** Called when a tab in the primary pane is activated */
  onNavigate: (path: string) => void
}

export function SplitView({ children, onNavigate }: SplitViewProps): React.ReactElement {
  const panes = useSplitStore((s) => s.panes)
  const focusedPaneId = useSplitStore((s) => s.focusedPaneId)
  const splitRatio = useSplitStore((s) => s.splitRatio)
  const activateTab = useSplitStore((s) => s.activateTab)
  const closeTab = useSplitStore((s) => s.closeTab)
  const splitTab = useSplitStore((s) => s.splitTab)
  const closePane = useSplitStore((s) => s.closePane)
  const focusPane = useSplitStore((s) => s.focusPane)
  const setSplitRatio = useSplitStore((s) => s.setSplitRatio)

  const dividerDragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const primaryPane = panes[0]
  const secondaryPane = panes[1] ?? null

  function handleActivate(paneId: string, tabId: string): void {
    activateTab(paneId, tabId)
    const pane = useSplitStore.getState().getPane(paneId)
    const tab = pane?.tabs.find((t) => t.id === tabId)
    if (!tab) return
    // Primary pane uses HashRouter navigation; secondary pane re-renders by path
    if (paneId === primaryPane?.id) {
      onNavigate(tab.path)
    }
    // Secondary pane picks up the new activeTabId via its own render
  }

  function handleClose(paneId: string, tabId: string): void {
    const { activatePath } = closeTab(paneId, tabId)
    const state = useSplitStore.getState()
    // If closing in primary pane, navigate the router
    if (paneId === state.panes[0]?.id && activatePath) {
      onNavigate(activatePath)
    }
  }

  function handleSplit(paneId: string, tabId: string): void {
    splitTab(tabId, paneId)
    // Primary router stays put — secondary pane renders from store state
  }

  // Draggable divider
  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dividerDragging.current = true
    function onMove(ev: MouseEvent): void {
      if (!dividerDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      // In RTL layout the primary pane is on the right, so we invert the ratio:
      // distance from the RIGHT edge / total width gives the primary pane's share.
      const isRtl = document.documentElement.dir === 'rtl' ||
        getComputedStyle(document.documentElement).direction === 'rtl'
      const raw = (ev.clientX - rect.left) / rect.width
      const ratio = isRtl ? (1 - raw) * 100 : raw * 100
      setSplitRatio(ratio)
    }
    function onUp(): void {
      dividerDragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [setSplitRatio])

  if (!primaryPane) return <>{children}</>

  const isSplit = !!secondaryPane
  // The active path for the secondary pane
  const secondaryActivePath = secondaryPane
    ? useSplitStore.getState().getActiveTab(secondaryPane.id)?.path ?? '/manager'
    : null

  return (
    <div className="split-view" ref={containerRef}>
      {/* ── Primary pane ── */}
      <div
        className={`split-pane${focusedPaneId === primaryPane.id ? ' split-pane--focused' : ''}`}
        style={isSplit ? { width: `${splitRatio}%` } : { flex: 1 }}
        onMouseDown={() => focusPane(primaryPane.id)}
      >
        <TabBar
          pane={primaryPane}
          isFocused={focusedPaneId === primaryPane.id}
          onActivate={handleActivate}
          onClose={handleClose}
          onSplit={handleSplit}
          onFocus={focusPane}
        />
        <div className="split-pane__content">
          {children}
        </div>
      </div>

      {/* ── Divider ── */}
      {isSplit && (
        <div className="split-divider" onMouseDown={onDividerMouseDown} title="اسحب لتغيير الحجم">
          <div className="split-divider__handle" />
        </div>
      )}

      {/* ── Secondary pane ── */}
      {isSplit && secondaryPane && secondaryActivePath && (
        <div
          className={`split-pane${focusedPaneId === secondaryPane.id ? ' split-pane--focused' : ''}`}
          style={{ width: `${100 - splitRatio}%` }}
          onMouseDown={() => focusPane(secondaryPane.id)}
        >
          <div className="split-pane__tabbar-row">
            <TabBar
              pane={secondaryPane}
              isFocused={focusedPaneId === secondaryPane.id}
              onActivate={handleActivate}
              onClose={handleClose}
              onSplit={handleSplit}
              onFocus={focusPane}
            />
            <button
              type="button"
              className="split-pane__close-pane"
              title="إغلاق العرض المقسم"
              onClick={(e) => { e.stopPropagation(); closePane(secondaryPane.id) }}
            >
              <MdClose />
            </button>
          </div>
          <div className="split-pane__content">
            <SecondaryPane path={secondaryActivePath} />
          </div>
        </div>
      )}
    </div>
  )
}

/** Initialise the split store with the first tab */
export function initSplitStore(tab: AppTab): void {
  if (useSplitStore.getState().panes.length === 0) {
    useSplitStore.getState().init(tab)
  }
}

/** Open a tab in the focused pane */
export function openTabInFocused(tabDef: Omit<AppTab, 'id'>): void {
  useSplitStore.getState().openInFocused(tabDef, mkTabId)
}
