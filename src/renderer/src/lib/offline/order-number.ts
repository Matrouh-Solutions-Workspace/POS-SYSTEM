/**
 * REQ-13: Removed unused global order counter (LAST_ORDER_KEY / nextLocalOrderReference).
 * Only per-shift sequential order references are used.
 */
const TERMINAL_KEY = 'abdokofta.terminalId'
const SHIFT_ORDER_PREFIX = 'abdokofta.shiftOrderNumber.'

function randomTerminalId(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function getTerminalId(): string {
  const existing = localStorage.getItem(TERMINAL_KEY)
  if (existing) return existing
  const terminalId = randomTerminalId()
  localStorage.setItem(TERMINAL_KEY, terminalId)
  return terminalId
}

export function orderCodeForSequence(prefix: string | undefined, orderNumber: number): string {
  const terminalId = (prefix?.trim() || getTerminalId()).toUpperCase()
  return `${terminalId}-${String(orderNumber).padStart(6, '0')}`
}

export function nextLocalShiftOrderReference(
  shiftId: string,
  prefix: string | undefined,
  minimumOrderNumber = 0
): {
  orderNumber: number
  orderCode: string
} {
  const key = `${SHIFT_ORDER_PREFIX}${shiftId}`
  const last = Number(localStorage.getItem(key) ?? '0')
  const orderNumber = Math.max(last, minimumOrderNumber) + 1
  localStorage.setItem(key, String(orderNumber))
  return {
    orderNumber,
    orderCode: orderCodeForSequence(prefix, orderNumber)
  }
}
