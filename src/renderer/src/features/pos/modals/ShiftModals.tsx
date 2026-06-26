import { useState } from 'react'
import { ConfirmDialog } from '@renderer/components/ui'
import type { ShiftClosurePreview } from '@renderer/features/shifts/shift-service'

// ── Opening cash modal ────────────────────────────────────────────────────

export function OpeningCashModal({
  onConfirm,
  onCancel
}: {
  onConfirm: (amount: number) => void
  onCancel: () => void
}): React.ReactElement {
  const [value, setValue] = useState('')

  return (
    <ConfirmDialog
      open
      onCancel={onCancel}
      onConfirm={() => onConfirm(Number(value) || 0)}
      title="فتح الشيفت"
      message="أدخل مبلغ الكاش الموجود في الدرج عند بدء الشيفت"
      confirmLabel="فتح الشيفت"
      cancelLabel="إلغاء"
    >
      <label className="field">
        <span>مبلغ الافتتاح</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0.00"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') onConfirm(Number(value) || 0)
          }}
        />
      </label>
    </ConfirmDialog>
  )
}

// ── Close shift modal (replaces window.confirm + window.prompt) ───────────

export function CloseShiftModal({
  preview,
  performanceEnabled,
  onConfirm,
  onCancel
}: {
  preview: ShiftClosurePreview
  performanceEnabled: boolean
  onConfirm: (closingCash: number | undefined, differenceReason?: string) => void
  onCancel: () => void
}): React.ReactElement {
  const [cashValue, setCashValue] = useState('')
  const [differenceReason, setDifferenceReason] = useState('')
  const parsedCash = cashValue.trim() === '' ? undefined : Number(cashValue)
  const difference = parsedCash === undefined || !Number.isFinite(parsedCash)
    ? undefined
    : parsedCash - preview.expectedCash
  const blocked = preview.pendingOrders.length > 0 || preview.incompletePaymentOrders.length > 0
  const reasonRequired = performanceEnabled && difference !== undefined && Math.abs(difference) >= 0.01

  return (
    <div className="modal-overlay">
      <div className="modal max-w-[560px]" onClick={(e) => e.stopPropagation()}>
        <div className="order-details__header">
          <h2 className="order-details__title">تسوية وإغلاق الشيفت</h2>
          <button type="button" className="order-details__close" onClick={onCancel} aria-label="إغلاق">×</button>
        </div>

        {blocked && (
          <div className="p-8 mb-14 rounded-6 border-2 border-[#ef4444] bg-[#fef2f2] text-[#991b1b] font-bold text-sm">
            لا يمكن إغلاق الشيفت:
            {preview.pendingOrders.length > 0 && ` ${preview.pendingOrders.length} طلب معلق أو غير مدفوع.`}
            {preview.incompletePaymentOrders.length > 0 && ` ${preview.incompletePaymentOrders.length} طلب بمدفوعات ناقصة.`}
          </div>
        )}

        <div className="stats-grid mb-14">
          <div className="stat-card"><div className="stat-card__label">رصيد الافتتاح</div><div className="stat-card__value">{preview.openingCash.toFixed(2)}</div></div>
          <div className="stat-card"><div className="stat-card__label">مبيعات نقدية</div><div className="stat-card__value">{preview.cashSales.toFixed(2)}</div></div>
          <div className="stat-card"><div className="stat-card__label">مبيعات بطاقة</div><div className="stat-card__value">{preview.cardSales.toFixed(2)}</div></div>
          <div className="stat-card"><div className="stat-card__label">مرتجعات نقدية</div><div className="stat-card__value">{preview.cashRefunds.toFixed(2)}</div></div>
          <div className="stat-card"><div className="stat-card__label">تسويات الكاش</div><div className="stat-card__value">{preview.cashAdjustments.toFixed(2)}</div></div>
          <div className="stat-card"><div className="stat-card__label">تسويات التقريب</div><div className="stat-card__value">{preview.roundingAdjustments.toFixed(2)}</div></div>
          <div className="stat-card"><div className="stat-card__label">الكاش المتوقع</div><div className="stat-card__value">{preview.expectedCash.toFixed(2)}</div></div>
        </div>

        <label className="field">
          <span>الكاش الفعلي في الدرج عند الإغلاق{performanceEnabled ? ' (مطلوب)' : ' (اختياري)'}</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={cashValue}
            onChange={(e) => setCashValue(e.target.value)}
            placeholder="0.00"
            autoFocus
          />
        </label>
        {difference !== undefined && (
          <div className={`stat-card my-10 border-2 ${Math.abs(difference) < 0.01 ? 'border-[#22c55e]' : 'border-[#f97316]'}`}>
            <div className="stat-card__label">الفرق: الفعلي - المتوقع</div>
            <div className="stat-card__value">{difference >= 0 ? '+' : ''}{difference.toFixed(2)}</div>
          </div>
        )}
        {reasonRequired && (
          <label className="field">
            <span>سبب فرق الكاش (مطلوب)</span>
            <textarea value={differenceReason} onChange={(event) => setDifferenceReason(event.target.value)} placeholder="مثال: عجز نقدي أثناء التسليم" />
          </label>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={
              blocked ||
              (performanceEnabled && parsedCash === undefined) ||
              (parsedCash !== undefined && (!Number.isFinite(parsedCash) || parsedCash < 0)) ||
              (reasonRequired && !differenceReason.trim())
            }
            onClick={() => onConfirm(parsedCash, differenceReason.trim() || undefined)}
          >
            تأكيد التسوية والإغلاق
          </button>
          <button type="button" className="btn btn--secondary" onClick={onCancel}>إلغاء</button>
        </div>
      </div>
    </div>
  )
}
