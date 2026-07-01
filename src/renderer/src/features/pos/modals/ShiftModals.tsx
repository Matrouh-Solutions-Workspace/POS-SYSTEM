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
  userRole,
  onConfirm,
  onHardOverride,
  onCancel
}: {
  preview: ShiftClosurePreview
  performanceEnabled: boolean
  userRole: 'manager' | 'supervisor' | 'cashier'
  onConfirm: (closingCash: number | undefined, differenceReason?: string, overrideReason?: string) => void
  onHardOverride?: () => void
  onCancel: () => void
}): React.ReactElement {
  const [cashValue, setCashValue] = useState('')
  const [differenceReason, setDifferenceReason] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const parsedCash = cashValue.trim() === '' ? undefined : Number(cashValue)
  const difference = parsedCash === undefined || !Number.isFinite(parsedCash)
    ? undefined
    : parsedCash - preview.expectedCash
  const hasCloseIssues = preview.pendingOrders.length > 0 || preview.incompletePaymentOrders.length > 0
  const canOverrideCloseIssues = userRole === 'manager' || userRole === 'supervisor'
  const blocked = hasCloseIssues && !canOverrideCloseIssues
  const overrideRequired = performanceEnabled && hasCloseIssues && canOverrideCloseIssues
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
          <div className="stat-card"><div className="stat-card__label">مدفوعات الموردين</div><div className="stat-card__value">{preview.supplierPaymentsTotal.toFixed(2)}</div></div>
          <div className="stat-card"><div className="stat-card__label">مصروفات نثرية</div><div className="stat-card__value">{preview.pettyCashExpensesTotal.toFixed(2)}</div></div>
          <div className="stat-card"><div className="stat-card__label">تسويات التقريب</div><div className="stat-card__value">{preview.roundingAdjustments.toFixed(2)}</div></div>
          <div className="stat-card"><div className="stat-card__label">إجمالي الطلبات غير المدفوعة</div><div className="stat-card__value">{preview.unpaidOrdersTotal.toFixed(2)}</div></div>
          <div className="stat-card"><div className="stat-card__label">الكاش المتوقع</div><div className="stat-card__value">{preview.expectedCash.toFixed(2)}</div></div>
        </div>

        {(preview.supplierPayments.length > 0 || preview.pettyCashExpenses.length > 0 || preview.suppliedInventory.length > 0) && (
          <div className="checkout-modal__section">
            {preview.supplierPayments.length > 0 && (
              <>
                <p className="checkout-modal__label">مدفوعات الموردين</p>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>المورد</th>
                      <th>المبلغ</th>
                      <th>طريقة الدفع</th>
                      <th>المستخدم</th>
                      <th>الوقت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.supplierPayments.map((tx) => (
                      <tr key={tx.id}>
                        <td>{tx.supplierName ?? '-'}</td>
                        <td>{Math.abs(tx.amount).toFixed(2)}</td>
                        <td>نقدي</td>
                        <td>{tx.userName}</td>
                        <td>{new Date(tx.createdAt).toLocaleTimeString('ar-EG')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {preview.pettyCashExpenses.length > 0 && (
              <>
                <p className="checkout-modal__label">مصروفات نثرية</p>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>المبلغ</th>
                      <th>السبب</th>
                      <th>المستخدم</th>
                      <th>تأثير الدرج</th>
                      <th>الوقت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.pettyCashExpenses.map((tx) => (
                      <tr key={tx.id}>
                        <td>{Math.abs(tx.amount).toFixed(2)}</td>
                        <td>{tx.noteAr ?? '-'}</td>
                        <td>{tx.userName}</td>
                        <td>{tx.amount.toFixed(2)}</td>
                        <td>{new Date(tx.createdAt).toLocaleTimeString('ar-EG')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {preview.suppliedInventory.length > 0 && (
              <>
                <p className="checkout-modal__label">عمليات توريد المخزون</p>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>الصنف</th>
                      <th>الكمية</th>
                      <th>التكلفة</th>
                      <th>المورد</th>
                      <th>المستخدم</th>
                      <th>الوقت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.suppliedInventory.map((tx) => (
                      <tr key={tx.id}>
                        <td>{tx.ingredientNameAr}</td>
                        <td>{Math.abs(tx.quantity).toFixed(3).replace(/0+$/g, '').replace(/\.$/g, '')} {tx.unit}</td>
                        <td>{(tx.totalCost ?? 0).toFixed(2)}</td>
                        <td>{tx.supplierName ?? '-'}</td>
                        <td>{tx.userName}</td>
                        <td>{new Date(tx.createdAt).toLocaleTimeString('ar-EG')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

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

        {hasCloseIssues && (
          <div className="p-8 mt-12 mb-12 rounded-6 border-2 border-[#ef4444] bg-[#fef2f2] text-[#991b1b] font-bold text-sm">
            {blocked ? 'لا يمكن إغلاق الشيفت قبل معالجة التحذيرات:' : 'تحذير قبل إغلاق الشيفت:'}
            {preview.pendingOrders.length > 0 && ` ${preview.pendingOrders.length} طلب معلق أو غير مدفوع.`}
            {preview.incompletePaymentOrders.length > 0 && ` ${preview.incompletePaymentOrders.length} طلب بمدفوعات ناقصة.`}
          </div>
        )}
        {overrideRequired && (
          <label className="field">
            <span>سبب تجاوز تحذيرات الإغلاق (مطلوب)</span>
            <textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="مثال: تمت مراجعة الطلبات يدويًا بواسطة المدير" />
          </label>
        )}

        <div className="modal-actions">
          {userRole === 'manager' && onHardOverride && (
            <button
              type="button"
              className="btn btn--danger"
              onClick={onHardOverride}
              title="إغلاق الشيفت فورًا بدون إدخال كاش فعلي أو أسباب تسوية"
            >
              إغلاق إداري سريع بدون جرد
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            disabled={
              blocked ||
              (performanceEnabled && parsedCash === undefined) ||
              (parsedCash !== undefined && (!Number.isFinite(parsedCash) || parsedCash < 0)) ||
              (reasonRequired && !differenceReason.trim()) ||
              (overrideRequired && !overrideReason.trim())
            }
            onClick={() => onConfirm(parsedCash, differenceReason.trim() || undefined, overrideReason.trim() || undefined)}
          >
            تأكيد التسوية والإغلاق
          </button>
          <button type="button" className="btn btn--secondary" onClick={onCancel}>إلغاء</button>
        </div>
      </div>
    </div>
  )
}
