/**
 * Keyboard shortcut store
 *
 * Chord format: modifier(s) + key, all lowercase, joined with '+'.
 * Examples:  "ctrl+tab"   "ctrl+shift+tab"   "f5"   "ctrl+w"
 *
 * Action ids are stable strings used as keys in AppSettings.keyboardShortcuts.
 * Each action has a label (displayed in settings) and a handler registry
 * (populated at runtime by components that know how to execute it).
 */
import { create } from 'zustand'

// ── Action catalogue ──────────────────────────────────────────────────────
// Add new actions here; only the tab-navigation ones are implemented for now.

export interface ShortcutAction {
  id: string
  /** Arabic label shown in the settings UI */
  labelAr: string
  /** Group label for visual grouping in settings */
  groupAr: string
  /** Default chord — empty string = unbound */
  defaultChord: string
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  // ── Tab navigation ───────────────────────────────────────────────────────
  {
    id: 'tab.next',
    labelAr: 'التبويب التالي',
    groupAr: 'تنقل التبويبات',
    defaultChord: 'ctrl+tab'
  },
  {
    id: 'tab.prev',
    labelAr: 'التبويب السابق',
    groupAr: 'تنقل التبويبات',
    defaultChord: 'ctrl+shift+tab'
  },
  {
    id: 'tab.close',
    labelAr: 'إغلاق التبويب الحالي',
    groupAr: 'تنقل التبويبات',
    defaultChord: 'ctrl+w'
  },
  {
    id: 'tab.focusNext',
    labelAr: 'التركيز على الجزء التالي (split)',
    groupAr: 'تنقل التبويبات',
    defaultChord: 'ctrl+shift+arrowright'
  },
  {
    id: 'tab.focusPrev',
    labelAr: 'التركيز على الجزء السابق (split)',
    groupAr: 'تنقل التبويبات',
    defaultChord: 'ctrl+shift+arrowleft'
  },
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `tab.select${i + 1}`,
    labelAr: `اختيار التبويب رقم ${i + 1}`,
    groupAr: 'تنقل التبويبات',
    defaultChord: `alt+${i + 1}`
  })),
]

/** Merge saved overrides onto defaults */
export function resolveChords(saved: Record<string, string> = {}): Record<string, string> {
  const result: Record<string, string> = {}
  for (const action of SHORTCUT_ACTIONS) {
    result[action.id] = saved[action.id] ?? action.defaultChord
  }
  return result
}

// ── Chord normalisation ───────────────────────────────────────────────────

export function eventToChord(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey)  parts.push('ctrl')
  if (e.altKey)   parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  if (e.metaKey)  parts.push('meta')
  // Normalise key: lowercase, replace space-like names
  const key = e.key.toLowerCase()
  if (key !== 'control' && key !== 'alt' && key !== 'shift' && key !== 'meta') {
    parts.push(key)
  }
  return parts.join('+')
}

export function chordToDisplay(chord: string): string {
  if (!chord) return '—'
  return chord
    .split('+')
    .map((p) => {
      switch (p) {
        case 'ctrl':  return 'Ctrl'
        case 'alt':   return 'Alt'
        case 'shift': return 'Shift'
        case 'meta':  return '⌘'
        case 'arrowleft':  return '←'
        case 'arrowright': return '→'
        case 'arrowup':    return '↑'
        case 'arrowdown':  return '↓'
        case 'tab':   return 'Tab'
        case ' ':     return 'Space'
        default:      return p.toUpperCase()
      }
    })
    .join(' + ')
}

// ── Store ─────────────────────────────────────────────────────────────────

type Handler = () => void

interface KeyboardState {
  /** Resolved chord map: action id → chord */
  chords: Record<string, string>
  /** Runtime handler registry: action id → handler function */
  handlers: Map<string, Handler>
  isCapturingShortcut: boolean

  /** Load chords from persisted settings */
  loadChords: (saved: Record<string, string> | undefined) => void

  /** Update a single chord (before saving to DB) */
  setChord: (actionId: string, chord: string) => void

  /** Register a runtime handler for an action */
  registerHandler: (actionId: string, handler: Handler) => () => void
  setCapturingShortcut: (capturing: boolean) => void

  /** Dispatch: find action matching chord, call its handler */
  dispatch: (chord: string) => boolean
}

export const useKeyboardStore = create<KeyboardState>((set, get) => ({
  chords: resolveChords({}),
  handlers: new Map(),
  isCapturingShortcut: false,

  loadChords(saved) {
    set({ chords: resolveChords(saved) })
  },

  setChord(actionId, chord) {
    set((s) => ({ chords: { ...s.chords, [actionId]: chord } }))
  },

  registerHandler(actionId, handler) {
    get().handlers.set(actionId, handler)
    return () => {
      const m = get().handlers
      if (m.get(actionId) === handler) m.delete(actionId)
    }
  },

  setCapturingShortcut(capturing) {
    set({ isCapturingShortcut: capturing })
  },

  dispatch(chord) {
    if (get().isCapturingShortcut) return false
    if (!chord) return false
    const { chords, handlers } = get()
    for (const [actionId, bound] of Object.entries(chords)) {
      if (bound && bound === chord) {
        const handler = handlers.get(actionId)
        if (handler) { handler(); return true }
      }
    }
    return false
  }
}))
