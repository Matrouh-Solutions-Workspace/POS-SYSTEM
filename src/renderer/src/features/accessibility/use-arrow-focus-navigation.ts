import { useEffect } from 'react'
import { useKeyboardStore } from '@renderer/features/keyboard/keyboard-store'

const FOCUSABLE_SELECTOR = [
  'button:not(:disabled)',
  'a[href]',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

const SCOPE_SELECTOR = [
  '[role="listbox"]',
  '[role="menu"]',
  '[role="tablist"]',
  '[role="grid"]',
  '[role="table"]',
  'table',
  '.data-table',
  '.inner-tabs',
  '.table-actions',
  '.receipt-section-list',
  '.receipt-preview-items',
  '.settings-form-grid',
  '.pos-items',
  '.pos-cart',
  '.app-sidebar__nav',
  '.tab-content',
  'main'
].join(',')

export function useArrowFocusNavigation(): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (useKeyboardStore.getState().isCapturingShortcut) return
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
      if (event.altKey || event.ctrlKey || event.metaKey) return

      const active = document.activeElement
      if (!(active instanceof HTMLElement)) return
      if (isTextEntry(active)) return

      const scope = active.closest(SCOPE_SELECTOR) ?? document.body
      const focusables = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((node) => node !== active && isVisible(node) && isNaturallyNavigable(node))

      if (focusables.length === 0) return

      const next = nearestInDirection(active, focusables, event.key) ?? nextByDomOrder(scope, active, event.key)
      if (!next) return

      event.preventDefault()
      next.focus({ preventScroll: false })
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [])
}

function isTextEntry(element: HTMLElement): boolean {
  if (element.isContentEditable) return true
  if (element instanceof HTMLTextAreaElement) return true
  if (element instanceof HTMLSelectElement) return true
  if (!(element instanceof HTMLInputElement)) return false
  if (['range', 'radio'].includes(element.type)) return true
  const textTypes = new Set([
    'text',
    'search',
    'url',
    'tel',
    'email',
    'password',
    'number',
    'date',
    'datetime-local',
    'month',
    'time',
    'week'
  ])
  return textTypes.has(element.type)
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
}

function isNaturallyNavigable(element: HTMLElement): boolean {
  const ariaHidden = element.getAttribute('aria-hidden')
  return ariaHidden !== 'true'
}

function nearestInDirection(
  active: HTMLElement,
  candidates: HTMLElement[],
  key: string
): HTMLElement | null {
  const current = center(active.getBoundingClientRect())
  let best: { node: HTMLElement; score: number } | null = null

  for (const node of candidates) {
    const point = center(node.getBoundingClientRect())
    const dx = point.x - current.x
    const dy = point.y - current.y
    const primary = key === 'ArrowRight' ? dx : key === 'ArrowLeft' ? -dx : key === 'ArrowDown' ? dy : -dy
    if (primary <= 4) continue
    const cross = key === 'ArrowLeft' || key === 'ArrowRight' ? Math.abs(dy) : Math.abs(dx)
    const score = primary * 3 + cross
    if (!best || score < best.score) best = { node, score }
  }

  return best?.node ?? null
}

function nextByDomOrder(scope: Element, active: HTMLElement, key: string): HTMLElement | null {
  const focusables = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((node) => isVisible(node) && isNaturallyNavigable(node))
  const index = focusables.indexOf(active)
  if (index < 0) return null
  const direction = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1
  return focusables[(index + direction + focusables.length) % focusables.length] ?? null
}

function center(rect: DOMRect): { x: number; y: number } {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  }
}
