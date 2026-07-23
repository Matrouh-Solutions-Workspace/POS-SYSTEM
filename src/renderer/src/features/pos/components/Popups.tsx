import { useEffect, useRef, useState } from 'react'
import type { MenuItem, MenuItemAttachment, MenuItemSizeOption } from '@shared/types'

// ── Floating popup wrapper ────────────────────────────────────────────────

export function FloatingPopup({
  anchor,
  onClose,
  children
}: {
  anchor: DOMRect
  onClose: () => void
  children: React.ReactNode
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="weight-popup"
      style={{
        position: 'fixed',
        zIndex: 500,
        left: anchor.left,
        top: anchor.bottom + 6,
        minWidth: Math.max(anchor.width || 160, 220)
      }}
    >
      {children}
    </div>
  )
}

// ── Weight popup ──────────────────────────────────────────────────────────

export function WeightPopup({
  item,
  anchor,
  onSelect,
  onClose
}: {
  item: MenuItem
  anchor: DOMRect
  onSelect: (kg: number, unitPrice: number) => void
  onClose: () => void
}): React.ReactElement {
  const [customGrams, setCustomGrams] = useState('')
  const options = item.weightedPriceOptions ?? []
  const customUnitPrice = item.customWeightUnitPrice ?? item.price

  return (
    <FloatingPopup anchor={anchor} onClose={onClose}>
      <div className="weight-popup__header">
        <span>{item.nameAr}</span>
        <span className="weight-popup__price">
          {item.allowCustomWeight ? `${customUnitPrice.toFixed(2)} / كجم مخصص` : 'أسعار محددة'}
        </span>
      </div>
      {options.length > 0 ? (
        <div className="weight-popup__shortcuts">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="weight-popup__btn"
              onClick={() => { onSelect(option.weightKg, option.price / option.weightKg); onClose() }}
            >
              <span>{option.label}</span>
              <span>{option.price.toFixed(2)}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="weight-popup__empty">لا توجد أسعار محددة لهذا الصنف</p>
      )}
      {item.allowCustomWeight && (
        <div className="weight-popup__custom">
          <input
            type="number"
            min="1"
            step="1"
            value={customGrams}
            onChange={(e) => setCustomGrams(e.target.value)}
            placeholder="جرام"
          />
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => {
              const grams = Number(customGrams)
              if (grams <= 0) return
              onSelect(grams / 1000, customUnitPrice)
              onClose()
            }}
          >
            إضافة
          </button>
        </div>
      )}
    </FloatingPopup>
  )
}

// ── Size popup ────────────────────────────────────────────────────────────

export function SizePopup({
  item,
  anchor,
  onSelect,
  onClose
}: {
  item: MenuItem
  anchor: DOMRect
  onSelect: (size: MenuItemSizeOption) => void
  onClose: () => void
}): React.ReactElement {
  return (
    <FloatingPopup anchor={anchor} onClose={onClose}>
      <div className="weight-popup__header">
        <span>{item.nameAr}</span>
        <span className="weight-popup__price">اختر الحجم</span>
      </div>
      <div className="weight-popup__shortcuts">
        {(item.sizeOptions ?? []).map((size) => (
          <button
            key={size.id}
            type="button"
            className="weight-popup__btn"
            onClick={() => { onSelect(size); onClose() }}
          >
            <span>{size.labelAr}</span>
            <span>{size.price.toFixed(2)}</span>
          </button>
        ))}
      </div>
    </FloatingPopup>
  )
}

// ── Addon popup ───────────────────────────────────────────────────────────

export function AddonPopup({
  item,
  anchor,
  onConfirm,
  onClose
}: {
  item: MenuItem
  anchor: DOMRect
  onConfirm: (selected: MenuItemAttachment[]) => void
  onClose: () => void
}): React.ReactElement {
  const attachments = item.attachments ?? []
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  function toggle(id: string): void {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id])
  }

  return (
    <FloatingPopup anchor={anchor} onClose={onClose}>
      <div className="weight-popup__header">
        <span>{item.nameAr}</span>
        <span className="weight-popup__price">اختيار المرفقات</span>
      </div>
      <div className="grid gap-8">
        {attachments.map((attachment) => (
          <label
            key={attachment.id}
            className="flex items-center justify-between p-8 rounded-10 bg-[rgba(255,255,255,0.04)] cursor-pointer"
          >
            <span className="flex items-center gap-8">
              <input
                type="checkbox"
                checked={selectedIds.includes(attachment.id)}
                onChange={() => toggle(attachment.id)}
              />
              <span>{attachment.nameAr}</span>
            </span>
            <span>{attachment.price.toFixed(2)}</span>
          </label>
        ))}
      </div>
      <div className="modal-actions mt-12">
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => {
            onConfirm(attachments.filter((attachment) => selectedIds.includes(attachment.id)))
            onClose()
          }}
        >
          إضافة
        </button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={onClose}>
          إلغاء
        </button>
      </div>
    </FloatingPopup>
  )
}
