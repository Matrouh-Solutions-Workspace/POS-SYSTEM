const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'نقدي',
  card: 'بطاقة',
  bank: 'تحويل بنكي',
  other: 'أخرى',
  split: 'نقدي + بطاقة'
}

const PAYMENT_SOURCE_LABELS: Record<string, string> = {
  cash_drawer: 'درج الكاش',
  external: 'مصدر خارجي'
}

const DEVICE_LABELS: Record<string, string> = {
  'Master POS': 'جهاز الماستر',
  master: 'جهاز الماستر',
  side: 'جهاز فرعي'
}

export function repairMojibake(value?: string | null): string {
  if (!value) return ''
  if (!/[ØÙ][\u0080-\u00ff]|�/.test(value)) return value

  try {
    const bytes = Uint8Array.from(Array.from(value, (char) => char.charCodeAt(0) & 0xff))
    const decoded = new TextDecoder('utf-8').decode(bytes)
    if (/[\u0600-\u06ff]/.test(decoded)) return decoded
  } catch {
    // Keep the original fallback path below.
  }

  return ''
}

export function formatPaymentMethod(method?: string | null): string {
  if (!method) return '-'
  return PAYMENT_METHOD_LABELS[method] ?? 'طريقة دفع غير معروفة'
}

export function formatPaymentSource(source?: string | null): string {
  if (!source) return '-'
  return PAYMENT_SOURCE_LABELS[source] ?? 'مصدر غير معروف'
}

export function formatPaymentMethodAndSource(
  method?: string | null,
  source?: string | null
): string {
  if (!method && !source) return '-'
  if (!source) return formatPaymentMethod(method)
  if (!method) return formatPaymentSource(source)
  return `${formatPaymentMethod(method)} / ${formatPaymentSource(source)}`
}

export function formatDeviceLabel(deviceId?: string | null): string {
  if (!deviceId) return '-'
  const repaired = repairMojibake(deviceId)
  return DEVICE_LABELS[repaired] ?? DEVICE_LABELS[deviceId] ?? repaired
}

export function localizeTechnicalText(value?: string | null): string {
  const repaired = repairMojibake(value)
  if (!repaired) return ''

  return repaired
    .replace(/\bcash_drawer\b/g, 'درج الكاش')
    .replace(/\bcash\b/g, 'نقدي')
    .replace(/\bcard\b/g, 'بطاقة')
    .replace(/\bbank\b/g, 'تحويل بنكي')
    .replace(/\bsplit\b/g, 'نقدي + بطاقة')
    .replace(/\bexternal\b/g, 'مصدر خارجي')
    .replace(/\bproduction\b/g, 'إنتاج مخزون')
    .replace(/\bSupplier Payments\b/g, 'مدفوعات الموردين')
    .replace(/\bPetty Cash Expenses\b/g, 'مصروفات نثرية')
}
