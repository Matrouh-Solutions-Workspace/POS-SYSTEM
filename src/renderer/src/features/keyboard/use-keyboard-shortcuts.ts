/**
 * useKeyboardShortcuts — mount once at the app root.
 *
 * Listens for keydown globally, converts the event to a chord string,
 * and dispatches it to the keyboard store. Returns early if the focused
 * element is an editable input/textarea so typing isn't intercepted.
 */
import { useEffect } from 'react'
import { eventToChord, useKeyboardStore } from './keyboard-store'

/** Tags where keyboard shortcuts should NOT fire (user is typing) */
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export function useGlobalKeyboardShortcuts(): void {
  const dispatch = useKeyboardStore((s) => s.dispatch)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (useKeyboardStore.getState().isCapturingShortcut) return

      const target = e.target as HTMLElement | null
      // Don't intercept typing in form fields
      if (target) {
        if (EDITABLE_TAGS.has(target.tagName)) return
        if (target.isContentEditable) return
      }

      const chord = eventToChord(e)
      const handled = dispatch(chord)
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [dispatch])
}
