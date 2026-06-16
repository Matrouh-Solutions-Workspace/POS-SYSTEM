/**
 * Split-view store.
 *
 * Layout model:
 *   panes: SplitPane[]   — ordered left-to-right (RTL: right-to-left)
 *   Each pane has its own ordered tab list and an activeTabId.
 *   The "primary" pane is always panes[0].
 *   A second pane appears when the user splits a tab.
 *
 * Rules:
 *   - Max 2 panes (can extend later).
 *   - A tab belongs to exactly one pane.
 *   - Closing all tabs in a pane removes the pane.
 *   - The last tab in the last pane cannot be closed.
 */
import { create } from 'zustand'
import type { AppTab } from './tab-store'

export interface SplitPane {
  id: string
  tabs: AppTab[]
  activeTabId: string | null
}

interface SplitState {
  panes: SplitPane[]
  focusedPaneId: string | null
  /** 0–100 — percentage width of the first pane */
  splitRatio: number

  /** Bootstrap: set the initial pane with an initial tab */
  init: (tab: AppTab) => void

  /** Open or activate a tab in the focused pane */
  openInFocused: (tab: Omit<AppTab, 'id'>, generateId: () => string) => void

  /** Move a tab into a new split pane (or existing second pane) */
  splitTab: (tabId: string, fromPaneId: string) => void

  /** Activate a tab within its pane and focus that pane */
  activateTab: (paneId: string, tabId: string) => void

  /** Close a tab. Removes pane if empty (unless it's the only pane + last tab) */
  closeTab: (paneId: string, tabId: string) => { activatePath: string | null }

  /** Close a split pane entirely (merge tabs back to primary) */
  closePane: (paneId: string) => void

  /** Focus a pane */
  focusPane: (paneId: string) => void

  /** Update split ratio (drag divider) */
  setSplitRatio: (ratio: number) => void

  /** Get a pane by id */
  getPane: (paneId: string) => SplitPane | undefined

  /** Get the tab that should be rendered as "current" for a pane */
  getActiveTab: (paneId: string) => AppTab | null

  /** Reset all tab/pane state — call on logout so the next user starts clean */
  reset: () => void

  /** Reorder tabs within a pane by moving tabId to a new index position */
  reorderTab: (paneId: string, tabId: string, toIndex: number) => void

  /** Move a tab from one pane to another */
  moveTabToPane: (fromPaneId: string, tabId: string, toPaneId: string, toIndex?: number) => void
}

let _paneSeq = 0
let _tabSeq = 0

export function mkPaneId(): string { return `pane-${++_paneSeq}` }
export function mkTabId(): string  { return `tab-${++_tabSeq}-${Date.now()}` }

export const useSplitStore = create<SplitState>((set, get) => ({
  panes: [],
  focusedPaneId: null,
  splitRatio: 50,

  init(tab) {
    const paneId = mkPaneId()
    set({
      panes: [{ id: paneId, tabs: [tab], activeTabId: tab.id }],
      focusedPaneId: paneId
    })
  },

  openInFocused(tabDef, generateId) {
    const { panes, focusedPaneId } = get()
    const paneId = focusedPaneId ?? panes[0]?.id
    if (!paneId) return

    set((s) => ({
      panes: s.panes.map((pane) => {
        if (pane.id !== paneId) return pane
        // Reuse existing tab with same path in this pane
        const existing = pane.tabs.find((t) => t.path === tabDef.path)
        if (existing) return { ...pane, activeTabId: existing.id }
        const id = generateId()
        return { ...pane, tabs: [...pane.tabs, { ...tabDef, id }], activeTabId: id }
      })
    }))
  },

  splitTab(tabId, fromPaneId) {
    const { panes } = get()
    if (panes.length >= 2) {
      // Move tab into existing second pane instead of creating a third
      const targetPane = panes.find((p) => p.id !== fromPaneId)
      if (!targetPane) return
      const sourcePane = panes.find((p) => p.id === fromPaneId)
      if (!sourcePane) return
      const tab = sourcePane.tabs.find((t) => t.id === tabId)
      if (!tab) return

      // Don't move if it's the only tab in source
      if (sourcePane.tabs.length <= 1) return

      set((s) => ({
        panes: s.panes.map((pane) => {
          if (pane.id === fromPaneId) {
            const remaining = pane.tabs.filter((t) => t.id !== tabId)
            const newActive = remaining.find((t) => t.id === pane.activeTabId)?.id
              ?? remaining[remaining.length - 1]?.id ?? null
            return { ...pane, tabs: remaining, activeTabId: newActive }
          }
          if (pane.id === targetPane.id) {
            // Don't duplicate if already there
            if (pane.tabs.some((t) => t.path === tab.path)) {
              return { ...pane, activeTabId: pane.tabs.find((t) => t.path === tab.path)!.id }
            }
            return { ...pane, tabs: [...pane.tabs, tab], activeTabId: tab.id }
          }
          return pane
        }),
        focusedPaneId: targetPane.id
      }))
      return
    }

    // Create a new second pane
    const sourcePane = panes.find((p) => p.id === fromPaneId)
    if (!sourcePane) return
    const tab = sourcePane.tabs.find((t) => t.id === tabId)
    if (!tab) return
    if (sourcePane.tabs.length <= 1) return // can't leave pane empty

    const newPaneId = mkPaneId()
    set((s) => ({
      panes: [
        ...s.panes.map((pane) => {
          if (pane.id !== fromPaneId) return pane
          const remaining = pane.tabs.filter((t) => t.id !== tabId)
          const newActive = remaining.find((t) => t.id === pane.activeTabId)?.id
            ?? remaining[remaining.length - 1]?.id ?? null
          return { ...pane, tabs: remaining, activeTabId: newActive }
        }),
        { id: newPaneId, tabs: [tab], activeTabId: tab.id }
      ],
      focusedPaneId: newPaneId,
      splitRatio: 50
    }))
  },

  activateTab(paneId, tabId) {
    set((s) => ({
      panes: s.panes.map((pane) =>
        pane.id === paneId ? { ...pane, activeTabId: tabId } : pane
      ),
      focusedPaneId: paneId
    }))
  },

  closeTab(paneId, tabId) {
    const { panes } = get()
    const pane = panes.find((p) => p.id === paneId)
    if (!pane) return { activatePath: null }

    // Never close the very last tab of the very last pane
    const totalTabs = panes.reduce((sum, p) => sum + p.tabs.length, 0)
    if (totalTabs <= 1) return { activatePath: pane.tabs[0]?.path ?? null }

    const remaining = pane.tabs.filter((t) => t.id !== tabId)

    if (remaining.length === 0) {
      // Remove pane entirely
      const newPanes = panes.filter((p) => p.id !== paneId)
      const newFocus = newPanes[0]?.id ?? null
      const activatePath = newFocus
        ? newPanes[0]!.tabs.find((t) => t.id === newPanes[0]!.activeTabId)?.path ?? null
        : null
      set({ panes: newPanes, focusedPaneId: newFocus })
      return { activatePath }
    }

    const wasActive = pane.activeTabId === tabId
    const idx = pane.tabs.findIndex((t) => t.id === tabId)
    const nextTab = wasActive
      ? (pane.tabs[idx + 1] ?? pane.tabs[idx - 1] ?? remaining[0])
      : pane.tabs.find((t) => t.id === pane.activeTabId) ?? remaining[0]

    set((s) => ({
      panes: s.panes.map((p) =>
        p.id !== paneId ? p : { ...p, tabs: remaining, activeTabId: nextTab?.id ?? null }
      )
    }))

    const activatePath = paneId === get().focusedPaneId ? (nextTab?.path ?? null) : null
    return { activatePath }
  },

  closePane(paneId) {
    const { panes } = get()
    if (panes.length <= 1) return
    const newPanes = panes.filter((p) => p.id !== paneId)
    set({ panes: newPanes, focusedPaneId: newPanes[0]?.id ?? null })
  },

  focusPane(paneId) {
    set({ focusedPaneId: paneId })
  },

  setSplitRatio(ratio) {
    set({ splitRatio: Math.max(20, Math.min(80, ratio)) })
  },

  getPane(paneId) {
    return get().panes.find((p) => p.id === paneId)
  },

  getActiveTab(paneId) {
    const pane = get().panes.find((p) => p.id === paneId)
    if (!pane) return null
    return pane.tabs.find((t) => t.id === pane.activeTabId) ?? pane.tabs[0] ?? null
  },

  reset() {
    // Wipe all panes and tabs so the next user starts with a blank slate
    set({ panes: [], focusedPaneId: null, splitRatio: 50 })
  },

  reorderTab(paneId, tabId, toIndex) {
    set((s) => ({
      panes: s.panes.map((pane) => {
        if (pane.id !== paneId) return pane
        const fromIndex = pane.tabs.findIndex((t) => t.id === tabId)
        if (fromIndex === -1 || fromIndex === toIndex) return pane
        const tabs = [...pane.tabs]
        const [moved] = tabs.splice(fromIndex, 1)
        tabs.splice(toIndex, 0, moved!)
        return { ...pane, tabs }
      })
    }))
  },

  moveTabToPane(fromPaneId, tabId, toPaneId, toIndex) {
    const { panes } = get()
    if (fromPaneId === toPaneId) {
      // Same pane — just reorder
      if (toIndex !== undefined) get().reorderTab(fromPaneId, tabId, toIndex)
      return
    }
    const sourcePane = panes.find((p) => p.id === fromPaneId)
    const targetPane = panes.find((p) => p.id === toPaneId)
    if (!sourcePane || !targetPane) return

    const tab = sourcePane.tabs.find((t) => t.id === tabId)
    if (!tab) return

    // Can't leave a pane with 0 tabs (would close the pane — use splitTab instead)
    if (sourcePane.tabs.length <= 1) return

    set((s) => ({
      panes: s.panes.map((pane) => {
        if (pane.id === fromPaneId) {
          const remaining = pane.tabs.filter((t) => t.id !== tabId)
          const newActive = pane.activeTabId === tabId
            ? (remaining[remaining.length - 1]?.id ?? null)
            : pane.activeTabId
          return { ...pane, tabs: remaining, activeTabId: newActive }
        }
        if (pane.id === toPaneId) {
          // Don't duplicate same path
          if (pane.tabs.some((t) => t.path === tab.path)) {
            return { ...pane, activeTabId: pane.tabs.find((t) => t.path === tab.path)!.id }
          }
          const insertAt = toIndex !== undefined
            ? Math.min(toIndex, pane.tabs.length)
            : pane.tabs.length
          const tabs = [...pane.tabs]
          tabs.splice(insertAt, 0, tab)
          return { ...pane, tabs, activeTabId: tab.id }
        }
        return pane
      }),
      focusedPaneId: toPaneId
    }))
  }
}))
