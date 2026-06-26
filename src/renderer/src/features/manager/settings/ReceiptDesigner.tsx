import { useState, useMemo, useEffect, type CSSProperties } from 'react'
import type { AppSettings, Order, OrderItem, ReceiptSectionId } from '@shared/types'
import { updateSettings } from '@renderer/features/orders/order-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import {
  buildReceiptHtml,
  normalizeReceiptSections,
  receiptSectionLabel
} from '@renderer/features/receipt/receipt-builder'
import { MdAdd, MdArrowDownward, MdArrowUpward, MdDelete, MdDragIndicator, MdImage, MdPrint, MdSave } from 'react-icons/md'

export type ReceiptPreviewItem = {
  id: string
  nameAr: string
  quantity: number
  unitPrice: number
  noteAr?: string
}

const RECEIPT_PRINTER_PIXEL_WIDTH = 576
const RECEIPT_ASCII_MAX_COLUMNS = 96
const RECEIPT_ASCII_MIN_COLUMNS = 48
const RECEIPT_LOGO_MIN_WIDTH_PERCENT = 20
const RECEIPT_LOGO_MAX_WIDTH_PERCENT = 100

function clampReceiptLogoWidth(width?: number): number {
  return Math.max(RECEIPT_ASCII_MIN_COLUMNS, Math.min(RECEIPT_ASCII_MAX_COLUMNS, Number(width) || RECEIPT_ASCII_MAX_COLUMNS))
}

function clampReceiptLogoMaxWidthPercent(width?: number): number {
  return Math.max(RECEIPT_LOGO_MIN_WIDTH_PERCENT, Math.min(RECEIPT_LOGO_MAX_WIDTH_PERCENT, Number(width) || RECEIPT_LOGO_MAX_WIDTH_PERCENT))
}

function initialReceiptLogoWidth(width?: number): number {
  const numeric = Number(width) || RECEIPT_ASCII_MAX_COLUMNS
  return numeric < 80 ? RECEIPT_ASCII_MAX_COLUMNS : clampReceiptLogoWidth(numeric)
}

function logoPreviewBlockStyle(align: AppSettings['receiptLogoAlign'], maxWidthPercent: number): CSSProperties {
  const margin =
    align === 'left'
      ? '10px auto 0 0'
      : align === 'right'
        ? '10px 0 0 auto'
        : '10px auto 0'
  return { width: `${maxWidthPercent}%`, margin }
}

function fitAsciiPreview(ascii: string, maxWidthPercent: number): string {
  const columns = Math.max(12, Math.round(RECEIPT_ASCII_MAX_COLUMNS * clampReceiptLogoMaxWidthPercent(maxWidthPercent) / 100))
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

function hasOversizedAscii(ascii: string): boolean {
  return ascii.split('\n').some((line) => line.length > RECEIPT_ASCII_MAX_COLUMNS)
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
    reader.readAsDataURL(file)
  })
}

function cropImageBounds(image: HTMLImageElement): { x: number; y: number; width: number; height: number } {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return { x: 0, y: 0, width: image.width, height: image.height }
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let minX = canvas.width
  let minY = canvas.height
  let maxX = 0
  let maxY = 0
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const offset = (y * canvas.width + x) * 4
      const alpha = data[offset + 3]
      const luminance = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114
      if (alpha > 10 && luminance < 248) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }
  if (minX > maxX || minY > maxY) return { x: 0, y: 0, width: image.width, height: image.height }
  const pad = 4
  const x = Math.max(0, minX - pad)
  const y = Math.max(0, minY - pad)
  const right = Math.min(canvas.width, maxX + pad)
  const bottom = Math.min(canvas.height, maxY + pad)
  return { x, y, width: right - x, height: bottom - y }
}

function processLogoImage(dataUrl: string, width: number, threshold: number, invert: boolean): Promise<{ monoDataUrl: string; ascii: string }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const crop = cropImageBounds(image)
      const safeWidth = clampReceiptLogoWidth(width)
      const ratio = crop.height / Math.max(1, crop.width)
      const asciiHeight = Math.max(12, Math.round(safeWidth * ratio * 0.42))
      const asciiCanvas = document.createElement('canvas')
      asciiCanvas.width = safeWidth
      asciiCanvas.height = asciiHeight
      const asciiCtx = asciiCanvas.getContext('2d')
      if (!asciiCtx) { resolve({ monoDataUrl: dataUrl, ascii: '' }); return }
      asciiCtx.fillStyle = '#fff'
      asciiCtx.fillRect(0, 0, safeWidth, asciiHeight)
      asciiCtx.imageSmoothingEnabled = true
      asciiCtx.imageSmoothingQuality = 'high'
      asciiCtx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, safeWidth, asciiHeight)
      const pixels = asciiCtx.getImageData(0, 0, safeWidth, asciiHeight).data
      const luminanceMap = new Array<number>(safeWidth * asciiHeight)
      for (let y = 0; y < asciiHeight; y += 1) {
        for (let x = 0; x < safeWidth; x += 1) {
          const offset = (y * safeWidth + x) * 4
          const alpha = pixels[offset + 3] / 255
          luminanceMap[y * safeWidth + x] = (pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114) * alpha + 255 * (1 - alpha)
        }
      }
      const chars = invert ? '@%#*+=-:. ' : ' .:-=+*#%@'
      const lines: string[] = []
      const edgeStrength = 72
      const thresholdBias = (176 - threshold) / 255
      for (let y = 0; y < asciiHeight; y += 1) {
        let line = ''
        for (let x = 0; x < safeWidth; x += 1) {
          const center = luminanceMap[y * safeWidth + x] ?? 255
          const left = luminanceMap[y * safeWidth + Math.max(0, x - 1)] ?? center
          const right = luminanceMap[y * safeWidth + Math.min(safeWidth - 1, x + 1)] ?? center
          const top = luminanceMap[Math.max(0, y - 1) * safeWidth + x] ?? center
          const bottom = luminanceMap[Math.min(asciiHeight - 1, y + 1) * safeWidth + x] ?? center
          const edge = Math.min(1, (Math.abs(left - right) + Math.abs(top - bottom)) / edgeStrength)
          const darkness = Math.max(0, Math.min(1, 1 - center / 255 + thresholdBias))
          const ink = Math.max(darkness * 0.95, edge * 0.8)
          const index = Math.max(0, Math.min(chars.length - 1, Math.round(ink * (chars.length - 1))))
          line += chars[index]
        }
        lines.push(line.replace(/\s+$/g, ''))
      }

      const monoWidth = RECEIPT_PRINTER_PIXEL_WIDTH
      const monoHeight = Math.max(24, Math.round(monoWidth * ratio))
      const monoCanvas = document.createElement('canvas')
      monoCanvas.width = monoWidth
      monoCanvas.height = monoHeight
      const monoCtx = monoCanvas.getContext('2d')
      if (!monoCtx) { resolve({ monoDataUrl: dataUrl, ascii: lines.join('\n') }); return }
      monoCtx.fillStyle = '#fff'
      monoCtx.fillRect(0, 0, monoWidth, monoHeight)
      monoCtx.imageSmoothingEnabled = true
      monoCtx.imageSmoothingQuality = 'high'
      monoCtx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, monoWidth, monoHeight)
      const imageData = monoCtx.getImageData(0, 0, monoWidth, monoHeight)
      for (let i = 0; i < imageData.data.length; i += 4) {
        const alpha = imageData.data[i + 3] / 255
        const luminance = (imageData.data[i] * 0.299 + imageData.data[i + 1] * 0.587 + imageData.data[i + 2] * 0.114) * alpha + 255 * (1 - alpha)
        const black = invert ? luminance >= threshold : luminance < threshold
        const value = black ? 0 : 255
        imageData.data[i] = value
        imageData.data[i + 1] = value
        imageData.data[i + 2] = value
        imageData.data[i + 3] = 255
      }
      monoCtx.putImageData(imageData, 0, 0)
      resolve({ monoDataUrl: monoCanvas.toDataURL('image/png'), ascii: lines.join('\n') })
    }
    image.onerror = () => reject(new Error('Failed to process image'))
    image.src = dataUrl
  })
}

export function ReceiptDesigner({
  settings,
  onSettingsSaved
}: {
  settings: AppSettings
  onSettingsSaved: (settings: AppSettings) => void
}): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [sectionOrder, setSectionOrder] = useState<ReceiptSectionId[]>(() => normalizeReceiptSections(settings.receiptSectionOrder))
  const [hiddenSections, setHiddenSections] = useState<ReceiptSectionId[]>(settings.receiptHiddenSections ?? [])
  const [showItemNotes, setShowItemNotes] = useState(settings.receiptShowItemNotes !== false)
  const [compactMode, setCompactMode] = useState(Boolean(settings.receiptCompactMode))
  const [logoDataUrl, setLogoDataUrl] = useState(settings.receiptLogoDataUrl ?? '')
  const [logoProcessedDataUrl, setLogoProcessedDataUrl] = useState(settings.receiptLogoProcessedDataUrl ?? '')
  const [logoAscii, setLogoAscii] = useState(settings.receiptLogoAscii ?? '')
  const [logoMode, setLogoMode] = useState<AppSettings['receiptLogoMode']>(settings.receiptLogoMode ?? 'image')
  const [logoThreshold, setLogoThreshold] = useState(settings.receiptLogoThreshold ?? 176)
  const [logoWidth, setLogoWidth] = useState(initialReceiptLogoWidth(settings.receiptLogoWidth))
  const [logoInvert, setLogoInvert] = useState(Boolean(settings.receiptLogoInvert))
  const [logoAlign, setLogoAlign] = useState<AppSettings['receiptLogoAlign']>(settings.receiptLogoAlign ?? 'center')
  const [logoMaxWidthPercent, setLogoMaxWidthPercent] = useState(clampReceiptLogoMaxWidthPercent(settings.receiptLogoMaxWidthPercent))
  const [draggingSection, setDraggingSection] = useState<ReceiptSectionId | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [previewItems, setPreviewItems] = useState<ReceiptPreviewItem[]>([
    { id: 'preview-1', nameAr: 'وجبة كفتة', quantity: 2, unitPrice: 95, noteAr: 'زيادة صوص' },
    { id: 'preview-2', nameAr: 'بطاطس', quantity: 1, unitPrice: 25 },
    { id: 'preview-3', nameAr: 'مشروب', quantity: 2, unitPrice: 18 }
  ])

  const previewSettings = useMemo<AppSettings>(() => ({
    ...settings,
    receiptSectionOrder: sectionOrder,
    receiptHiddenSections: hiddenSections,
    receiptShowItemNotes: showItemNotes,
    receiptCompactMode: compactMode,
    receiptLogoEnabled: !hiddenSections.includes('logo'),
    receiptLogoDataUrl: logoDataUrl || undefined,
    receiptLogoProcessedDataUrl: logoProcessedDataUrl || undefined,
    receiptLogoAscii: logoAscii || undefined,
    receiptLogoMode: logoMode,
    receiptLogoThreshold: logoThreshold,
    receiptLogoWidth: logoWidth,
    receiptLogoInvert: logoInvert,
    receiptLogoAlign: logoAlign,
    receiptLogoMaxWidthPercent: logoMaxWidthPercent
  }), [compactMode, hiddenSections, logoAlign, logoAscii, logoDataUrl, logoInvert, logoMaxWidthPercent, logoMode, logoProcessedDataUrl, logoThreshold, logoWidth, sectionOrder, settings, showItemNotes])

  const previewHtml = useMemo(() => {
    const subtotal = previewItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
    const taxAmount = Math.round(subtotal * 0.14 * 100) / 100
    const order: Order = {
      id: 'receipt-preview',
      orderNumber: 128,
      orderCode: 'A-128',
      status: 'completed',
      orderType: 'dine_in',
      paymentStatus: 'paid',
      tableNameAr: 'ترابيزة 5',
      tableCategoryAr: 'الصالة',
      cashierId: 'preview',
      cashierName: 'كاشير تجريبي',
      subtotal,
      taxRate: 14,
      taxAmount,
      total: subtotal + taxAmount,
      noteAr: 'ملاحظة تظهر في المعاينة',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: Date.now()
    }
    const items: OrderItem[] = previewItems.map((item) => ({
      id: item.id,
      orderId: order.id,
      menuItemId: item.id,
      nameAr: item.nameAr,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.quantity * item.unitPrice,
      noteAr: item.noteAr
    }))
    return buildReceiptHtml(order, items, previewSettings)
  }, [previewItems, previewSettings])

  function moveSection(section: ReceiptSectionId, direction: -1 | 1): void {
    setSectionOrder((current) => {
      const index = current.indexOf(section)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      const [removed] = next.splice(index, 1)
      next.splice(nextIndex, 0, removed!)
      return next
    })
  }

  function dropSection(target: ReceiptSectionId): void {
    if (!draggingSection || draggingSection === target) return
    setSectionOrder((current) => {
      const without = current.filter((id) => id !== draggingSection)
      const targetIndex = without.indexOf(target)
      without.splice(targetIndex, 0, draggingSection)
      return without
    })
    setDraggingSection(null)
  }

  async function handleLogoFile(file: File | undefined): Promise<void> {
    if (!file) return
    const dataUrl = await readFileAsDataUrl(file)
    const processed = await processLogoImage(dataUrl, logoWidth, logoThreshold, logoInvert)
    setLogoDataUrl(dataUrl)
    setLogoProcessedDataUrl(processed.monoDataUrl)
    setLogoAscii(processed.ascii)
  }

  async function regenerateLogoAssets(next?: { width?: number; threshold?: number; invert?: boolean }): Promise<void> {
    if (!logoDataUrl) return
    const processed = await processLogoImage(
      logoDataUrl,
      next?.width ?? logoWidth,
      next?.threshold ?? logoThreshold,
      next?.invert ?? logoInvert
    )
    setLogoProcessedDataUrl(processed.monoDataUrl)
    setLogoAscii(processed.ascii)
  }

  useEffect(() => {
    if (!logoDataUrl) return
    if (settings.receiptLogoWidth !== logoWidth || hasOversizedAscii(logoAscii)) {
      void regenerateLogoAssets({ width: logoWidth })
    }
  }, [])

  function updatePreviewItem(id: string, patch: Partial<ReceiptPreviewItem>): void {
    setPreviewItems((items) => items.map((item) => (
      item.id === id ? { ...item, ...patch } : item
    )))
  }

  async function saveDesigner(): Promise<void> {
    setSaving(true)
    setMessage(null)
    let processedDataUrl = logoProcessedDataUrl
    let processedAscii = logoAscii
    if (logoDataUrl && (!processedDataUrl || !processedAscii)) {
      const processed = await processLogoImage(logoDataUrl, logoWidth, logoThreshold, logoInvert)
      processedDataUrl = processed.monoDataUrl
      processedAscii = processed.ascii
      setLogoProcessedDataUrl(processedDataUrl)
      setLogoAscii(processedAscii)
    }
    const patch: Partial<AppSettings> = {
      receiptSectionOrder: sectionOrder,
      receiptHiddenSections: hiddenSections,
      receiptShowItemNotes: showItemNotes,
      receiptCompactMode: compactMode,
      receiptLogoEnabled: !hiddenSections.includes('logo'),
      receiptLogoDataUrl: logoDataUrl || undefined,
      receiptLogoProcessedDataUrl: processedDataUrl || undefined,
      receiptLogoAscii: processedAscii || undefined,
      receiptLogoMode: logoMode,
      receiptLogoThreshold: logoThreshold,
      receiptLogoWidth: logoWidth,
      receiptLogoInvert: logoInvert,
      receiptLogoAlign: logoAlign,
      receiptLogoMaxWidthPercent: logoMaxWidthPercent
    }
    try {
      await updateSettings(patch, user)
      onSettingsSaved({ ...settings, ...patch, updatedAt: Date.now() })
      setMessage('تم حفظ تصميم الإيصال')
    } catch {
      setMessage('فشل حفظ تصميم الإيصال')
    } finally {
      setSaving(false)
    }
  }

  async function printPreviewReceipt(): Promise<void> {
    setMessage(null)
    const result = await window.electronAPI.printReceipt(previewHtml)
    setMessage(result.ok ? 'تم إرسال معاينة الإيصال للطباعة' : result.error ?? 'فشل اختبار طباعة معاينة الإيصال')
  }

  return (
    <div className="receipt-designer">
      {message && <p className={`form-message ${message.includes('فشل') ? 'form-message--error' : 'form-message--ok'}`}>{message}</p>}
      <div className="receipt-designer__workspace">
        <div className="receipt-designer__controls">
          <div className="receipt-designer__preview">
            <div className="receipt-designer__preview-actions">
              <h3 className="card__title">معاينة الإيصال</h3>
              <button type="button" className="btn btn--secondary" onClick={() => void printPreviewReceipt()}>
                <MdPrint /> اختبار طباعة المعاينة
              </button>
            </div>
            <iframe title="POS receipt preview" srcDoc={previewHtml} />
          </div>

          <div className="receipt-designer-panel">
            <h3 className="card__title"><MdDragIndicator /> ترتيب ومحتوى الإيصال</h3>
            <div className="receipt-section-list">
              {sectionOrder.map((section, index) => {
                const hidden = hiddenSections.includes(section)
                return (
                  <div
                    key={section}
                    className={`receipt-section-row${hidden ? ' receipt-section-row--hidden' : ''}`}
                    draggable
                    onDragStart={() => setDraggingSection(section)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => dropSection(section)}
                  >
                    <MdDragIndicator aria-hidden="true" />
                    <label className="field--checkbox receipt-section-row__label">
                      <input
                        type="checkbox"
                        checked={!hidden}
                        onChange={(e) => setHiddenSections((current) => (
                          e.target.checked
                            ? current.filter((id) => id !== section)
                            : [...new Set([...current, section])]
                        ))}
                      />
                      <span>{receiptSectionLabel(section)}</span>
                    </label>
                    <div className="table-actions">
                      <button type="button" className="btn btn--secondary btn--sm" disabled={index === 0} onClick={() => moveSection(section, -1)} aria-label="Move up">
                        <MdArrowUpward />
                      </button>
                      <button type="button" className="btn btn--secondary btn--sm" disabled={index === sectionOrder.length - 1} onClick={() => moveSection(section, 1)} aria-label="Move down">
                        <MdArrowDownward />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="settings-form-grid mt-12">
              <label className="field--checkbox">
                <input type="checkbox" checked={showItemNotes} onChange={(e) => setShowItemNotes(e.target.checked)} />
                <span>إظهار ملاحظات الأصناف</span>
              </label>
              <label className="field--checkbox">
                <input type="checkbox" checked={compactMode} onChange={(e) => setCompactMode(e.target.checked)} />
                <span>نسخة مضغوطة للورق الحراري</span>
              </label>
            </div>
          </div>

          <div className="receipt-designer-panel">
            <h3 className="card__title"><MdImage /> شعار المطعم ومعالجة الصورة</h3>
            <div className="settings-form-grid">
              <label className="field">
                <span>رفع الشعار</span>
                <input type="file" accept="image/*" onChange={(e) => void handleLogoFile(e.target.files?.[0])} />
              </label>
              <label className="field">
                <span>طريقة العرض</span>
                <select value={logoMode} onChange={(e) => setLogoMode(e.target.value as AppSettings['receiptLogoMode'])}>
                  <option value="image">صورة عادية</option>
                  <option value="mono">أبيض وأسود ESC/POS</option>
                  <option value="ascii">ASCII Art للطابعات الضعيفة</option>
                </select>
              </label>
              <label className="field">
                <span>محاذاة الشعار</span>
                <select value={logoAlign} onChange={(e) => setLogoAlign(e.target.value as AppSettings['receiptLogoAlign'])}>
                  <option value="center">في المنتصف</option>
                  <option value="right">يمين</option>
                  <option value="left">شمال</option>
                </select>
              </label>
              <label className="field">
                <span>أقصى عرض للشعار: {logoMaxWidthPercent}%</span>
                <input
                  type="range"
                  min={RECEIPT_LOGO_MIN_WIDTH_PERCENT}
                  max={RECEIPT_LOGO_MAX_WIDTH_PERCENT}
                  step="5"
                  value={logoMaxWidthPercent}
                  onChange={(e) => setLogoMaxWidthPercent(clampReceiptLogoMaxWidthPercent(Number(e.target.value)))}
                />
              </label>
              <label className="field">
                <span>عرض المعالجة</span>
                <input
                  type="range"
                  min={RECEIPT_ASCII_MIN_COLUMNS}
                  max={RECEIPT_ASCII_MAX_COLUMNS}
                  value={logoWidth}
                  onChange={(e) => {
                    const width = Number(e.target.value)
                    setLogoWidth(width)
                    void regenerateLogoAssets({ width })
                  }}
                />
              </label>
              <label className="field">
                <span>حد الأبيض والأسود</span>
                <input
                  type="range"
                  min="80"
                  max="230"
                  value={logoThreshold}
                  onChange={(e) => {
                    const threshold = Number(e.target.value)
                    setLogoThreshold(threshold)
                    void regenerateLogoAssets({ threshold })
                  }}
                />
              </label>
              <label className="field--checkbox">
                <input
                  type="checkbox"
                  checked={logoInvert}
                  onChange={(e) => {
                    setLogoInvert(e.target.checked)
                    void regenerateLogoAssets({ invert: e.target.checked })
                  }}
                />
                <span>عكس الأبيض والأسود</span>
              </label>
            </div>
            {logoDataUrl && (
              <div className="receipt-logo-print-preview">
                <span>معاينة ما سيتم طباعته</span>
                {logoMode === 'ascii' ? (
                  <pre className="receipt-ascii receipt-ascii-preview" dir="ltr" style={logoPreviewBlockStyle(logoAlign, logoMaxWidthPercent)}>{fitAsciiPreview(logoAscii, logoMaxWidthPercent)}</pre>
                ) : (
                  <img
                    src={logoMode === 'mono' ? logoProcessedDataUrl || logoDataUrl : logoDataUrl}
                    alt="Receipt logo print preview"
                    style={logoPreviewBlockStyle(logoAlign, logoMaxWidthPercent)}
                  />
                )}
              </div>
            )}
          </div>

          <div className="receipt-designer-panel">
            <h3 className="card__title"><MdAdd /> أصناف تجريبية للمعاينة</h3>
            <div className="receipt-preview-items">
              {previewItems.map((item) => (
                <div key={item.id} className="receipt-preview-item">
                  <input value={item.nameAr} onChange={(e) => updatePreviewItem(item.id, { nameAr: e.target.value })} />
                  <input type="number" min="0.001" step="0.5" value={item.quantity} onChange={(e) => updatePreviewItem(item.id, { quantity: Number(e.target.value) || 1 })} />
                  <input type="number" min="0" step="1" value={item.unitPrice} onChange={(e) => updatePreviewItem(item.id, { unitPrice: Number(e.target.value) || 0 })} />
                  <input value={item.noteAr ?? ''} onChange={(e) => updatePreviewItem(item.id, { noteAr: e.target.value })} placeholder="ملاحظة" />
                  <button type="button" className="btn btn--danger btn--sm" onClick={() => setPreviewItems((items) => items.filter((x) => x.id !== item.id))}>
                    <MdDelete />
                  </button>
                </div>
              ))}
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setPreviewItems((items) => [...items, { id: `preview-${Date.now()}`, nameAr: 'صنف جديد', quantity: 1, unitPrice: 0 }])}
              >
                <MdAdd /> إضافة صنف للمعاينة
              </button>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn--primary" onClick={() => void saveDesigner()} disabled={saving}>
              <MdSave /> {saving ? 'جار الحفظ...' : 'حفظ تصميم الإيصال'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
