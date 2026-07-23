/**
 * Toast — notification toast system for success/error messages.
 *
 * Uses a simple event-driven pattern: call `showToast()` from anywhere
 * and a single `<ToastContainer />` mounted in App.tsx renders them.
 */
import { useCallback, useEffect, useState } from 'react'

export type ToastType = 'success' | 'error' | 'info'

interface ToastItem {
  id: string
  message: string
  type: ToastType
  duration: number
}

// ── Event bus ──────────────────────────────────────────────────────────────

type ToastListener = (toast: ToastItem) => void

const listeners: Set<ToastListener> = new Set()

export function showToast(
  message: string,
  type: ToastType = 'info',
  duration = 3000
): void {
  const item: ToastItem = {
    id: crypto.randomUUID(),
    message,
    type,
    duration
  }
  for (const listener of listeners) listener(item)
}

// ── Container component ───────────────────────────────────────────────────

export function ToastContainer(): React.ReactElement {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const addToast = useCallback((toast: ToastItem) => {
    setToasts((prev) => [...prev, toast])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id))
    }, toast.duration)
  }, [])

  useEffect(() => {
    listeners.add(addToast)
    return () => { listeners.delete(addToast) }
  }, [addToast])

  if (toasts.length === 0) return <></>

  return (
    <div className="ui-toast-container" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`ui-toast ui-toast--${toast.type}`}
          role="alert"
        >
          <span className="ui-toast__icon">
            {toast.type === 'success' && '✓'}
            {toast.type === 'error' && '✕'}
            {toast.type === 'info' && 'ℹ'}
          </span>
          <span className="ui-toast__message">{toast.message}</span>
          <button
            type="button"
            className="ui-toast__close"
            onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
            aria-label="إغلاق"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
