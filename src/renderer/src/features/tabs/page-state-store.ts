/**
 * Page state persistence store.
 *
 * Keeps arbitrary form/UI state keyed by route path so that switching
 * tabs doesn't reset inputs. Each page stores whatever slice it needs.
 *
 * Usage:
 *   const { get, set } = usePageState('/manager/items')
 *   // On mount: restore state with get()
 *   // On change: persist with set({ ...newState })
 */
import { create } from 'zustand'

type PageState = Record<string, unknown>

interface PageStateStore {
  states: Record<string, PageState>
  getState: (path: string) => PageState
  setState: (path: string, patch: PageState) => void
  clearState: (path: string) => void
}

export const usePageStateStore = create<PageStateStore>((set, get) => ({
  states: {},

  getState(path) {
    return get().states[path] ?? {}
  },

  setState(path, patch) {
    set((s) => ({
      states: {
        ...s.states,
        [path]: { ...(s.states[path] ?? {}), ...patch }
      }
    }))
  },

  clearState(path) {
    set((s) => {
      const { [path]: _, ...rest } = s.states
      return { states: rest }
    })
  }
}))

/**
 * Hook that returns a typed getter and setter for a specific page's state.
 * Call this at the top of any page component.
 *
 * @example
 * const { saved, save } = usePageState<{ activeTab: string }>('/manager/items')
 * const [tab, setTab] = useState(saved.activeTab ?? 'items')
 * useEffect(() => { save({ activeTab: tab }) }, [tab])
 */
export function usePageState<T extends PageState>(path: string): {
  saved: Partial<T>
  save: (patch: Partial<T>) => void
  clear: () => void
} {
  const getState = usePageStateStore((s) => s.getState)
  const setState = usePageStateStore((s) => s.setState)
  const clearState = usePageStateStore((s) => s.clearState)

  return {
    saved: getState(path) as Partial<T>,
    save: (patch) => setState(path, patch as PageState),
    clear: () => clearState(path)
  }
}
