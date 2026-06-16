/**
 * useTabShortcuts — registers tab-navigation keyboard handlers.
 *
 * Mount this inside AppShell (where navigate and useSplitStore are accessible).
 * It wires the keyboard store actions to the actual split-store operations.
 */
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSplitStore } from '@renderer/features/tabs/split-store'
import { useKeyboardStore } from './keyboard-store'

export function useTabShortcuts(): void {
  const navigate = useNavigate()
  const registerHandler = useKeyboardStore((s) => s.registerHandler)

  useEffect(() => {
    // ── tab.next ────────────────────────────────────────────────────────────
    const unregNext = registerHandler('tab.next', () => {
      const { panes, focusedPaneId, activateTab } = useSplitStore.getState()
      const pane = panes.find((p) => p.id === focusedPaneId) ?? panes[0]
      if (!pane || pane.tabs.length <= 1) return
      const idx = pane.tabs.findIndex((t) => t.id === pane.activeTabId)
      const nextIdx = (idx + 1) % pane.tabs.length
      const nextTab = pane.tabs[nextIdx]!
      activateTab(pane.id, nextTab.id)
      // If this is the primary pane, sync the router
      if (pane.id === panes[0]?.id) navigate(nextTab.path)
    })

    // ── tab.prev ────────────────────────────────────────────────────────────
    const unregPrev = registerHandler('tab.prev', () => {
      const { panes, focusedPaneId, activateTab } = useSplitStore.getState()
      const pane = panes.find((p) => p.id === focusedPaneId) ?? panes[0]
      if (!pane || pane.tabs.length <= 1) return
      const idx = pane.tabs.findIndex((t) => t.id === pane.activeTabId)
      const prevIdx = (idx - 1 + pane.tabs.length) % pane.tabs.length
      const prevTab = pane.tabs[prevIdx]!
      activateTab(pane.id, prevTab.id)
      if (pane.id === panes[0]?.id) navigate(prevTab.path)
    })

    // ── tab.close ───────────────────────────────────────────────────────────
    const unregClose = registerHandler('tab.close', () => {
      const { panes, focusedPaneId, closeTab } = useSplitStore.getState()
      const pane = panes.find((p) => p.id === focusedPaneId) ?? panes[0]
      if (!pane || !pane.activeTabId) return
      // Never close the very last tab
      const totalTabs = panes.reduce((sum, p) => sum + p.tabs.length, 0)
      if (totalTabs <= 1) return
      const { activatePath } = closeTab(pane.id, pane.activeTabId)
      // Sync router if we closed in primary pane
      if (pane.id === panes[0]?.id && activatePath) navigate(activatePath)
    })

    // ── tab.focusNext ────────────────────────────────────────────────────────
    const unregFocusNext = registerHandler('tab.focusNext', () => {
      const { panes, focusedPaneId, focusPane } = useSplitStore.getState()
      if (panes.length <= 1) return
      const idx = panes.findIndex((p) => p.id === focusedPaneId)
      const nextPane = panes[(idx + 1) % panes.length]!
      focusPane(nextPane.id)
    })

    // ── tab.focusPrev ────────────────────────────────────────────────────────
    const unregFocusPrev = registerHandler('tab.focusPrev', () => {
      const { panes, focusedPaneId, focusPane } = useSplitStore.getState()
      if (panes.length <= 1) return
      const idx = panes.findIndex((p) => p.id === focusedPaneId)
      const prevPane = panes[(idx - 1 + panes.length) % panes.length]!
      focusPane(prevPane.id)
    })

    const unregSelect = Array.from({ length: 9 }, (_, i) =>
      registerHandler(`tab.select${i + 1}`, () => {
        const { panes, focusedPaneId, activateTab } = useSplitStore.getState()
        const pane = panes.find((p) => p.id === focusedPaneId) ?? panes[0]
        const targetTab = pane?.tabs[i]
        if (!pane || !targetTab) return
        activateTab(pane.id, targetTab.id)
        if (pane.id === panes[0]?.id) navigate(targetTab.path)
      })
    )

    return () => {
      unregNext()
      unregPrev()
      unregClose()
      unregFocusNext()
      unregFocusPrev()
      for (const unreg of unregSelect) unreg()
    }
  }, [navigate, registerHandler])
}
