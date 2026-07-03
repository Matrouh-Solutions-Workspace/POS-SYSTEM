import type { DiscountType, OrderType } from '../types/order'

export interface CartLineInput {
  unitPrice: number
  quantity: number
}

export function lineTotal(unitPrice: number, quantity: number): number {
  return Math.round(unitPrice * quantity * 100) / 100
}

export function orderSubtotal(lines: CartLineInput[]): number {
  const sum = lines.reduce(
    (acc, l) => acc + lineTotal(l.unitPrice, l.quantity),
    0
  )
  return Math.round(sum * 100) / 100
}

/** Compute discount amount from subtotal */
export function computeDiscount(
  subtotal: number,
  discountType?: DiscountType,
  discountValue?: number
): number {
  if (!discountType || !discountValue || discountValue <= 0) return 0
  if (discountType === 'percent') {
    const pct = Math.min(100, Math.max(0, discountValue))
    return Math.round(subtotal * pct) / 100
  }
  // fixed
  return Math.min(subtotal, Math.max(0, Math.round(discountValue * 100) / 100))
}

/** Compute tax amount from (subtotal - discount) */
export function computeTax(afterDiscount: number, taxRate?: number): number {
  if (!taxRate || taxRate <= 0) return 0
  return Math.round(afterDiscount * taxRate) / 100
}

export function taxAppliesToOrderType(
  orderType: OrderType,
  taxApplicationMode?: 'all' | 'selected',
  taxOrderTypes?: OrderType[]
): boolean {
  if (taxApplicationMode !== 'selected') return true
  return (taxOrderTypes ?? []).includes(orderType)
}

export function effectiveTaxRate(
  taxRate: number | undefined,
  orderType: OrderType,
  taxApplicationMode?: 'all' | 'selected',
  taxOrderTypes?: OrderType[]
): number {
  if (!taxRate || taxRate <= 0) return 0
  return taxAppliesToOrderType(orderType, taxApplicationMode, taxOrderTypes) ? taxRate : 0
}

export function serviceAppliesToOrderType(
  orderType: OrderType,
  serviceApplicationMode?: 'all' | 'selected',
  serviceOrderTypes?: OrderType[]
): boolean {
  if (serviceApplicationMode !== 'selected') return true
  return (serviceOrderTypes ?? []).includes(orderType)
}

export function effectiveServiceRate(
  serviceRate: number | undefined,
  orderType: OrderType,
  serviceApplicationMode?: 'all' | 'selected',
  serviceOrderTypes?: OrderType[]
): number {
  if (!serviceRate || serviceRate <= 0) return 0
  return serviceAppliesToOrderType(orderType, serviceApplicationMode, serviceOrderTypes) ? serviceRate : 0
}

/** Compute service amount from (subtotal - discount) */
export function computeService(afterDiscount: number, serviceRate?: number): number {
  if (!serviceRate || serviceRate <= 0) return 0
  return Math.round(afterDiscount * serviceRate) / 100
}

/** Full order total: subtotal − discount + tax + service + deliveryFee */
export function orderTotal(
  subtotal: number,
  discountAmount = 0,
  taxAmount = 0,
  deliveryFee = 0,
  serviceAmount = 0
): number {
  return Math.round((subtotal - discountAmount + taxAmount + serviceAmount + deliveryFee) * 100) / 100
}
