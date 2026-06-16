import type { AppSettings, KitchenPrinter, MenuItem, Order, OrderItem } from '@shared/types'
import { orderReference } from '@shared/services/order-reference'
import { listMenuItems } from '@renderer/features/menu/menu-service'
import { listKitchenPrinters } from './printer-service'

export interface KitchenPrintJob {
  printerId: string
  printerName: string
  deviceName: string
  copies: number
  html: string
}

interface KitchenTicketItem extends OrderItem {
  sourceMenuItemId: string
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function quantityLabel(item: OrderItem): string {
  if (item.unitLabel) return `${item.quantity.toFixed(3)} ${item.unitLabel}`
  if (item.weightGrams != null) return `${item.weightGrams} جم`
  return item.quantity % 1 === 0 ? String(item.quantity) : item.quantity.toFixed(2)
}

function orderTypeLabel(order: Order): string {
  if (order.orderType === 'dine_in') return 'صالة'
  if (order.orderType === 'delivery') return 'دليفري'
  return 'تيك أواي'
}

export function buildKitchenTicketHtml(params: {
  order: Order
  items: KitchenTicketItem[]
  settings: AppSettings
  printer: KitchenPrinter
  title?: string
}): string {
  const { order, items, settings, printer } = params
  const visibility = printer.visibility
  const rows = items.map((item) => `
    <tr>
      <td class="qty">${escapeHtml(quantityLabel(item))}</td>
      <td>
        <strong>${escapeHtml(item.nameAr)}</strong>
        ${item.sizeLabelAr ? `<div class="muted">${escapeHtml(item.sizeLabelAr)}</div>` : ''}
        ${visibility.showItemNotes && item.noteAr ? `<div class="note">ملاحظة: ${escapeHtml(item.noteAr)}</div>` : ''}
      </td>
    </tr>
  `).join('')

  const customerParts = [
    order.customerName && `العميل: ${order.customerName}`,
    order.customerPhone && `الهاتف: ${order.customerPhone}`,
    order.customerAddress && `العنوان: ${order.customerAddress}`
  ].filter(Boolean)

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <style>
    * { box-sizing: border-box; }
    body { margin: 8px; font-family: Tahoma, Arial, sans-serif; color: #000; direction: rtl; }
    .ticket { width: 100%; }
    h1 { margin: 0; text-align: center; font-size: 18px; font-weight: 900; }
    .printer { text-align: center; margin: 4px 0 8px; font-size: 13px; font-weight: 800; border: 2px solid #000; padding: 3px; }
    .meta { border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 6px 0; margin: 6px 0; font-size: 12px; }
    .meta div { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    td { vertical-align: top; border-bottom: 1px dashed #aaa; padding: 6px 3px; font-size: 14px; }
    .qty { width: 54px; text-align: center; font-size: 16px; font-weight: 900; border-left: 1px solid #000; }
    .muted { color: #333; font-size: 11px; margin-top: 2px; }
    .note { font-size: 12px; font-weight: 800; margin-top: 3px; }
    .order-note { border: 1px solid #000; padding: 5px; margin-top: 8px; font-size: 12px; font-weight: 800; }
    .footer { text-align: center; margin-top: 8px; font-size: 10px; }
  </style>
</head>
<body>
  <div class="ticket">
    <h1>${escapeHtml(settings.restaurantNameAr)}</h1>
    <div class="printer">${escapeHtml(params.title ?? printer.name)}</div>
    <div class="meta">
      <div><strong>طلب</strong><span>#${escapeHtml(orderReference(order))}</span></div>
      ${visibility.showOrderType ? `<div><strong>النوع</strong><span>${escapeHtml(orderTypeLabel(order))}</span></div>` : ''}
      ${visibility.showTable && order.tableNameAr ? `<div><strong>الترابيزة</strong><span>${escapeHtml(order.tableNameAr)}${order.tableCategoryAr ? ` / ${escapeHtml(order.tableCategoryAr)}` : ''}</span></div>` : ''}
      ${visibility.showCashier ? `<div><strong>الكاشير</strong><span>${escapeHtml(order.cashierName)}</span></div>` : ''}
      <div><strong>الوقت</strong><span>${new Date(order.createdAt).toLocaleString('ar-EG')}</span></div>
      ${visibility.showCustomer && customerParts.length ? `<div><strong>بيانات العميل</strong><span>${escapeHtml(customerParts.join(' - '))}</span></div>` : ''}
    </div>
    <table><tbody>${rows}</tbody></table>
    ${visibility.showOrderNote && order.noteAr ? `<div class="order-note">ملاحظة الطلب: ${escapeHtml(order.noteAr)}</div>` : ''}
    <div class="footer">إيصال تجهيز داخلي - ليس فاتورة عميل</div>
  </div>
</body>
</html>`
}

export function buildKitchenPrintJobs(params: {
  order: Order
  orderItems: OrderItem[]
  menuItems: MenuItem[]
  printers: KitchenPrinter[]
  settings: AppSettings
}): KitchenPrintJob[] {
  const menuById = new Map(params.menuItems.map((item) => [item.id, item]))
  const printerById = new Map(params.printers.filter((printer) => printer.active).map((printer) => [printer.id, printer]))
  const itemsByPrinter = new Map<string, KitchenTicketItem[]>()

  for (const item of params.orderItems) {
    const sourceMenuItemId = item.attachmentForMenuItemId ?? item.menuItemId.split(':attachment:')[0] ?? item.menuItemId
    const menuItem = menuById.get(sourceMenuItemId)
    const printerIds = menuItem?.kitchenPrinterIds?.filter((id) => printerById.has(id)) ?? []
    for (const printerId of printerIds) {
      const current = itemsByPrinter.get(printerId) ?? []
      current.push({ ...item, sourceMenuItemId })
      itemsByPrinter.set(printerId, current)
    }
  }

  return [...itemsByPrinter.entries()].map(([printerId, items]) => {
    const printer = printerById.get(printerId)!
    return {
      printerId,
      printerName: printer.name,
      deviceName: printer.deviceName,
      copies: printer.copies,
      html: buildKitchenTicketHtml({ order: params.order, items, settings: params.settings, printer })
    }
  })
}

export async function printKitchenTickets(
  order: Order,
  orderItems: OrderItem[],
  settings: AppSettings
): Promise<{ ok: boolean; printed: number; failed: Array<{ printerName: string; error: string }> }> {
  const [menuItems, printers] = await Promise.all([listMenuItems(), listKitchenPrinters(true)])
  const jobs = buildKitchenPrintJobs({ order, orderItems, settings, menuItems, printers })
  if (!jobs.length) return { ok: true, printed: 0, failed: [] }
  return window.electronAPI.printKitchenBatch(jobs)
}
