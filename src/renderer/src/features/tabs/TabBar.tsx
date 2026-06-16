/**
 * TabBar — supports:
 *   - Click to activate
 *   - Middle-click to close
 *   - Drag to reorder within the same pane
 *   - Drag to the other pane's tab bar to move it there (split-view)
 *   - Right-click context menu (split / close)
 */
import { useRef, useEffect, useState } from 'react'
import { MdClose } from 'react-icons/md'
import { useSplitStore, type SplitPane } from './split-store'
import { TabContextMenu } from './TabContextMenu'
import { NAV_ICON_MAP } from '@renderer/config/navigation'

interface TabBarProps {
  pane: SplitPane
  isFocused: boolean
  onActivate: (paneId: string, tabId: string) => void
  onClose: (paneId: string, tabId: string) => void
  onSplit: (paneId: string, tabId: string) => void
  onFocus: (paneId: string) => void
}

interface ContextMenuState {
  x: number
  y: number
  tabId: string
}

// Module-level drag state — avoids React state overhead during drag
let _dragTabId: string | null = null
let _dragPaneId: string | null = null

export function TabBar({
  pane,
  isFocused,
  onActivate,
  onClose,
  onSplit,
  onFocus
}: TabBarProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)

  // dropIndex: which slot the dragged tab would land in if dropped now (-1 = none)
  const [dropIndex, setDropIndex] = useState<number>(-1)
  // fromOtherPane: true when the drag source is a different pane
  const [dropFromOther, setDropFromOther] = useState(false)
  // Tick bumped on dragEnd to force a re-render so isDragging clears correctly.
  // (_dragTabId is module-level and doesn't trigger React re-renders on its own.)
  const [, setDragTick] = useState(0)

  const panes = useSplitStore((s) => s.panes)
  const reorderTab = useSplitStore((s) => s.reorderTab)
  const moveTabToPane = useSplitStore((s) => s.moveTabToPane)

  // Scroll active tab into view
  useEffect(() => {
    if (!scrollRef.current) return
    const active = scrollRef.current.querySelector('.tab--active')
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [pane.activeTabId])

  function handleMouseDown(e: React.MouseEvent, tabId: string): void {
    // Middle-click to close
    if (e.button === 1) { e.preventDefault(); onClose(pane.id, tabId) }
  }

  function handleContextMenu(e: React.MouseEvent, tabId: string): void {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, tabId })
  }

  function activateIndex(index: number): void {
    const tab = pane.tabs[index]
    if (!tab) return
    onActivate(pane.id, tab.id)
  }

  function handleTabKeyDown(e: React.KeyboardEvent, index: number, tabId: string): void {
    let nextIndex = index
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % pane.tabs.length
    else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + pane.tabs.length) % pane.tabs.length
    else if (e.key === 'Home') nextIndex = 0
    else if (e.key === 'End') nextIndex = pane.tabs.length - 1
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onActivate(pane.id, tabId)
      return
    } else return
    e.preventDefault()
    activateIndex(nextIndex)
  }

  // ── Drag handlers ──────────────────────────────────────────────────────

  function handleDragStart(e: React.DragEvent, tabId: string): void {
    _dragTabId = tabId
    _dragPaneId = pane.id
    e.dataTransfer.effectAllowed = 'move'
    // Set drag image to the tab element itself for a clean ghost
    e.dataTransfer.setData('text/plain', tabId)
  }

  function handleDragEnd(): void {
    _dragTabId = null
    _dragPaneId = null
    setDropIndex(-1)
    setDropFromOther(false)
    setDragTick((t) => t + 1) // force re-render so isDragging evaluates to false
  }

  /**
   * Calculate which index the dragged tab should land in,
   * based on the mouse X position relative to the tabs.
   */
  function getDropIndex(e: React.DragEvent): number {
    if (!scrollRef.current) return pane.tabs.length
    const tabEls = Array.from(scrollRef.current.querySelectorAll<HTMLElement>('.tab'))
    // Find the first tab whose centre is to the right (LTR) or left (RTL) of the cursor
    const isRtl = document.documentElement.dir === 'rtl' ||
      getComputedStyle(document.documentElement).direction === 'rtl'

    for (let i = 0; i < tabEls.length; i++) {
      const rect = tabEls[i]!.getBoundingClientRect()
      const mid = rect.left + rect.width / 2
      if (isRtl ? e.clientX > mid : e.clientX < mid) return i
    }
    return pane.tabs.length
  }

  function handleDragOver(e: React.DragEvent): void {
    if (!_dragTabId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const fromOther = _dragPaneId !== null && _dragPaneId !== pane.id
    setDropFromOther(fromOther)
    setDropIndex(getDropIndex(e))
  }

  function handleDragLeave(): void {
    setDropIndex(-1)
    setDropFromOther(false)
  }

  function handleDrop(e: React.DragEvent): void {
    e.preventDefault()
    const tabId = _dragTabId
    const fromPaneId = _dragPaneId
    const targetIndex = getDropIndex(e)
    setDropIndex(-1)
    setDropFromOther(false)

    if (!tabId || !fromPaneId) return

    if (fromPaneId === pane.id) {
      // Same pane reorder
      reorderTab(pane.id, tabId, targetIndex)
    } else {
      // Move from other pane to this pane
      moveTabToPane(fromPaneId, tabId, pane.id, targetIndex)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const totalTabs = panes.reduce((sum, p) => sum + p.tabs.length, 0)

  return (
    <>
      <div
        className={`tab-bar${isFocused ? ' tab-bar--focused' : ''}${dropFromOther && dropIndex >= 0 ? ' tab-bar--drop-target' : ''}`}
        role="tablist"
        aria-label="التبويبات"
        onMouseDown={() => onFocus(pane.id)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="tab-bar__scroll" ref={scrollRef}>
          {pane.tabs.map((tab, idx) => {
            const Icon = NAV_ICON_MAP[tab.iconKey]
            const isActive = tab.id === pane.activeTabId
            const isDragging = _dragTabId === tab.id && _dragPaneId === pane.id
            // Show drop indicator line before this tab
            const showDropBefore = dropIndex === idx && _dragPaneId !== null

            return (
              <div
                key={tab.id}
                style={{ display: 'contents' }}
              >
                {/* Drop indicator */}
                {showDropBefore && (
                  <div
                    className="tab-drop-indicator"
                    aria-hidden="true"
                  />
                )}

                <div
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  draggable
                  className={[
                    'tab',
                    isActive && isFocused ? 'tab--active' : isActive ? 'tab--active tab--active-unfocused' : '',
                    isDragging ? 'tab--dragging' : ''
                  ].filter(Boolean).join(' ')}
                  onClick={() => onActivate(pane.id, tab.id)}
                  onMouseDown={(e) => handleMouseDown(e, tab.id)}
                  onKeyDown={(e) => handleTabKeyDown(e, idx, tab.id)}
                  onContextMenu={(e) => handleContextMenu(e, tab.id)}
                  onDragStart={(e) => handleDragStart(e, tab.id)}
                  onDragEnd={handleDragEnd}
                >
                  {Icon && <Icon className="tab__icon" aria-hidden="true" />}
                  <span className="tab__label">{tab.label}</span>
                  {totalTabs > 1 && (
                    <button
                      type="button"
                      className="tab__close"
                      aria-label={`إغلاق ${tab.label}`}
                      onClick={(e) => { e.stopPropagation(); onClose(pane.id, tab.id) }}
                    >
                      <MdClose />
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {/* Drop indicator at the end of the tab list */}
          {dropIndex === pane.tabs.length && _dragPaneId !== null && (
            <div className="tab-drop-indicator" aria-hidden="true" />
          )}
        </div>
      </div>

      {ctxMenu && (
        <TabContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          tabId={ctxMenu.tabId}
          paneId={pane.id}
          canSplit={pane.tabs.length > 1}
          onSplit={() => { onSplit(pane.id, ctxMenu.tabId); setCtxMenu(null) }}
          onClose={() => { onClose(pane.id, ctxMenu.tabId); setCtxMenu(null) }}
          onDismiss={() => setCtxMenu(null)}
        />
      )}
    </>
  )
}
