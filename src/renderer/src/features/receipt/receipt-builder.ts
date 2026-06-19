import type { Order, OrderItem, AppSettings, ReceiptSectionId } from '@shared/types'
import { orderReference } from '@shared/services/order-reference'

const RECEIPT_PAPER_WIDTH_MM = 80
const RECEIPT_PAGE_HEIGHT_MM = 297
const RECEIPT_ASCII_COLUMNS = 96

function receiptLogoMaxWidth(settings: AppSettings): number {
  return Math.max(20, Math.min(100, Number(settings.receiptLogoMaxWidthPercent) || 100))
}

function receiptLogoMargin(settings: AppSettings): string {
  if (settings.receiptLogoAlign === 'left') return '0 auto 6px 0'
  if (settings.receiptLogoAlign === 'right') return '0 0 6px auto'
  return '0 auto 6px'
}

export const DEFAULT_RECEIPT_SECTIONS: ReceiptSectionId[] = [
  'logo',
  'restaurant',
  'orderMeta',
  'customer',
  'items',
  'totals',
  'payment',
  'footer'
]

const SECTION_LABELS: Record<ReceiptSectionId, string> = {
  logo: 'الشعار',
  restaurant: 'بيانات المطعم',
  orderMeta: 'بيانات الطلب',
  customer: 'بيانات العميل',
  items: 'الأصناف',
  totals: 'الإجماليات',
  payment: 'الدفع',
  footer: 'التذييل'
}

export function receiptSectionLabel(section: ReceiptSectionId): string {
  return SECTION_LABELS[section]
}

export function normalizeReceiptSections(order?: ReceiptSectionId[]): ReceiptSectionId[] {
  const seen = new Set<ReceiptSectionId>()
  const normalized: ReceiptSectionId[] = []
  for (const id of order ?? []) {
    if (DEFAULT_RECEIPT_SECTIONS.includes(id) && !seen.has(id)) {
      seen.add(id)
      normalized.push(id)
    }
  }
  for (const id of DEFAULT_RECEIPT_SECTIONS) {
    if (!seen.has(id)) normalized.push(id)
  }
  return normalized
}

export function buildReceiptHtml(
  order: Order,
  items: OrderItem[],
  settings: AppSettings,
  options?: { isCopy?: boolean; label?: string }
): string {
  const cur = settings.currencySymbol
  const hidden = new Set(settings.receiptHiddenSections ?? [])
  const sections = normalizeReceiptSections(settings.receiptSectionOrder)
  const compact = Boolean(settings.receiptCompactMode)
  const logoMaxWidth = receiptLogoMaxWidth(settings)
  const logoMargin = receiptLogoMargin(settings)
  const sectionHtml = sections
    .filter((section) => !hidden.has(section))
    .map((section) => renderSection(section, order, items, settings, cur, options))
    .filter(Boolean)
    .join('\n')

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <style>
    @page { size: ${RECEIPT_PAPER_WIDTH_MM}mm ${RECEIPT_PAGE_HEIGHT_MM}mm; margin: 0; }
    * { box-sizing: border-box; }
    html {
      width: ${RECEIPT_PAPER_WIDTH_MM}mm;
      margin: 0;
      background: #fff;
    }
    body {
      font-family: 'Cairo', Tahoma, Arial, sans-serif;
      font-size: ${compact ? '11px' : '12px'};
      margin: ${compact ? '5px' : '8px'};
      width: calc(${RECEIPT_PAPER_WIDTH_MM}mm - ${compact ? '10px' : '16px'});
      direction: rtl;
      color: #000;
      background: #fff;
    }
    h1 { font-size: ${compact ? '15px' : '17px'}; text-align: center; margin: 0 0 2px; font-weight: 900; }
    .sub { text-align: center; font-size: 11px; color: #333; margin: 2px 0; }
    .receipt-logo { display: block; width: ${logoMaxWidth}%; max-width: ${logoMaxWidth}%; height: auto; margin: ${logoMargin}; object-fit: contain; }
    .receipt-ascii { direction: ltr; display: block; width: ${logoMaxWidth}%; max-width: ${logoMaxWidth}%; margin: ${logoMargin}; overflow: hidden; text-align: center; font-family: 'Courier New', monospace; font-size: ${compact ? '4.7px' : '5px'}; line-height: 0.76; white-space: pre; letter-spacing: 0; }
    table { width: 100%; border-collapse: collapse; margin: ${compact ? '5px' : '8px'} 0; }
    th, td { padding: ${compact ? '2px 3px' : '3px 4px'}; text-align: right; border-bottom: 1px dashed #bdbdbd; font-size: ${compact ? '10px' : '11px'}; vertical-align: top; }
    th { font-weight: 900; background: #f5f5f5; }
    small { color: #444; font-size: 10px; }
    .totals { margin: ${compact ? '5px' : '8px'} 0; }
    .totals div { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; font-size: 11px; }
    .grand-total { border-top: 2px solid #000; margin-top: 4px; padding-top: 4px; font-size: 13px; }
    .footer { text-align: center; margin-top: 10px; font-size: 10px; color: #333; white-space: pre-wrap; }
    hr { border: none; border-top: 1px dashed #999; margin: ${compact ? '5px' : '7px'} 0; }
    .order-type { background: #000; color: #fff; text-align: center; padding: 3px; font-weight: 900; margin: 4px 0; }
    .copy-label { text-align: center; font-weight: 900; border: 2px solid #000; padding: 2px 8px; margin: 4px auto; display: table; }
    .meta-line { margin: 2px 0; font-size: 11px; }
  </style>
</head>
<body>
  ${sectionHtml}
</body>
</html>`
}

function renderSection(
  section: ReceiptSectionId,
  order: Order,
  items: OrderItem[],
  settings: AppSettings,
  cur: string,
  options?: { isCopy?: boolean; label?: string }
): string {
  if (section === 'logo') return renderLogo(settings)
  if (section === 'restaurant') {
    return `
      <h1>${escapeHtml(settings.restaurantNameAr)}</h1>
      ${settings.phoneNumber ? `<p class="sub">${escapeHtml(settings.phoneNumber)}</p>` : ''}
      ${options?.isCopy ? `<p class="copy-label">${escapeHtml(options.label ?? 'نسخة')}</p>` : ''}
      <hr/>`
  }
  if (section === 'orderMeta') {
    return `
      <div class="order-type">${escapeHtml(orderTypeLabel(order))}</div>
      <p class="meta-line"><strong>طلب رقم:</strong> ${escapeHtml(orderReference(order))}</p>
      <p class="meta-line">${new Date(order.completedAt ?? order.createdAt).toLocaleString('ar-EG')}</p>
      <p class="meta-line">الكاشير: ${escapeHtml(order.cashierName)}</p>
      ${order.noteAr ? `<p class="meta-line">ملاحظة: ${escapeHtml(order.noteAr)}</p>` : ''}`
  }
  if (section === 'customer') return renderCustomer(order)
  if (section === 'items') return renderItems(items, settings, cur)
  if (section === 'totals') return `<div class="totals">${renderTotals(order, cur)}</div>`
  if (section === 'payment') return renderPayment(order)
  if (section === 'footer') return settings.receiptFooterAr ? `<hr/><p class="footer">${escapeHtml(settings.receiptFooterAr)}</p>` : ''
  return ''
}

function renderLogo(settings: AppSettings): string {
  if (settings.receiptLogoMode === 'ascii' && settings.receiptLogoAscii) {
    const columns = Math.max(12, Math.round(RECEIPT_ASCII_COLUMNS * receiptLogoMaxWidth(settings) / 100))
    return `<pre class="receipt-ascii">${escapeHtml(fitAsciiToReceipt(settings.receiptLogoAscii, columns))}</pre>`
  }
  const imageSrc = settings.receiptLogoMode === 'mono'
    ? settings.receiptLogoProcessedDataUrl || settings.receiptLogoDataUrl
    : settings.receiptLogoDataUrl
  if (!imageSrc) return ''
  return `<img class="receipt-logo" src="${escapeAttribute(imageSrc)}" alt="Restaurant logo" />`
}

function fitAsciiToReceipt(ascii: string, columns = RECEIPT_ASCII_COLUMNS): string {
  return ascii
    .split('\n')
    .map((line) => {
      if (line.length <= columns) return line
      let fitted = ''
      for (let i = 0; i < columns; i += 1) {
        const sourceIndex = Math.min(line.length - 1, Math.floor(i * line.length / columns))
        fitted += line[sourceIndex] ?? ' '
      }
      return fitted.replace(/\s+$/g, '')
    })
    .join('\n')
}

function renderCustomer(order: Order): string {
  if (order.orderType !== 'delivery') return ''
  const parts = [
    order.customerName && `<p class="meta-line">العميل: ${escapeHtml(order.customerName)}</p>`,
    order.customerPhone && `<p class="meta-line">الهاتف: ${escapeHtml(order.customerPhone)}</p>`,
    order.customerAddress && `<p class="meta-line">العنوان: ${escapeHtml(order.customerAddress)}</p>`
  ].filter(Boolean)
  return parts.length ? `<hr/>${parts.join('')}` : ''
}

function renderItems(items: OrderItem[], settings: AppSettings, cur: string): string {
  const showNotes = settings.receiptShowItemNotes !== false
  const rows = items
    .map((item) => `
      <tr>
        <td>${escapeHtml(item.nameAr)}${item.sizeLabelAr ? `<br/><small>${escapeHtml(item.sizeLabelAr)}</small>` : ''}${showNotes && item.noteAr ? `<br/><small>${escapeHtml(item.noteAr)}</small>` : ''}</td>
        <td style="text-align:center">${item.unitLabel ? item.quantity.toFixed(3) : item.quantity}</td>
        <td>${fm(item.unitPrice, cur)}</td>
        <td>${fm(item.lineTotal, cur)}</td>
      </tr>`)
    .join('')

  return `
    <table>
      <thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`
}

function renderTotals(order: Order, cur: string): string {
  const rows: string[] = []
  rows.push(`<div><span>المجموع الفرعي</span><span>${fm(order.subtotal, cur)}</span></div>`)
  if (order.discountAmount && order.discountAmount > 0) {
    const label = order.discountType === 'percent' ? `خصم (${order.discountValue}%)` : 'خصم'
    rows.push(`<div><span>${escapeHtml(label)}</span><span>- ${fm(order.discountAmount, cur)}</span></div>`)
  }
  if (order.taxAmount && order.taxAmount > 0) {
    rows.push(`<div><span>ضريبة القيمة المضافة (${order.taxRate}%)</span><span>${fm(order.taxAmount, cur)}</span></div>`)
  }
  if (order.serviceAmount && order.serviceAmount > 0) {
    rows.push(`<div><span>خدمة (${order.serviceRate}%)</span><span>${fm(order.serviceAmount, cur)}</span></div>`)
  }
  if (order.deliveryFee && order.deliveryFee > 0) {
    rows.push(`<div><span>رسوم التوصيل</span><span>${fm(order.deliveryFee, cur)}</span></div>`)
  }
  rows.push(`<div class="grand-total"><strong>الإجمالي</strong><strong>${fm(order.total, cur)}</strong></div>`)
  return rows.join('')
}

function renderPayment(order: Order): string {
  if (order.paymentStatus === 'split') return `<div class="totals"><div><span>الدفع</span><span>نقدي + بطاقة</span></div></div>`
  if (order.paymentStatus === 'paid') return `<div class="totals"><div><span>الدفع</span><span>مدفوع</span></div></div>`
  return ''
}

function fm(amount: number, cur: string): string {
  return `${amount.toFixed(2)} ${cur}`
}

function orderTypeLabel(order: Order): string {
  if (order.orderType === 'dine_in') {
    return order.tableNameAr
      ? `صالة - ${order.tableNameAr}${order.tableCategoryAr ? ` / ${order.tableCategoryAr}` : ''}`
      : 'صالة'
  }
  if (order.orderType === 'delivery') return 'دليفري'
  return 'تيك أواي'
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttribute(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

export async function printReceipt(
  order: Order,
  items: OrderItem[],
  settings: AppSettings,
  options?: { isCopy?: boolean; label?: string }
): Promise<boolean> {
  const html = buildReceiptHtml(order, items, settings, options)
  if (window.electronAPI?.printReceipt) {
    const result = await window.electronAPI.printReceipt(html)
    if (!result.ok) {
      window.alert(result.error ?? 'فشلت الطباعة. راجع إعدادات الطابعة في إعدادات المدير.')
    }
    return result.ok
  }
  const receiptWindow = window.open('', '_blank', 'width=400,height=600')
  if (!receiptWindow) return false
  receiptWindow.document.write(html)
  receiptWindow.document.close()
  receiptWindow.print()
  return true
}
