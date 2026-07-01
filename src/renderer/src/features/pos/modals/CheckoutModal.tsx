import type { DiscountType, OrderType } from '@shared/types'
import type { CashRoundingAccess } from '@renderer/features/rounding/cash-rounding-service'

export interface CheckoutModalProps {
  orderType: OrderType
  checkoutMethod: 'cash' | 'card' | 'split'
  setCheckoutMethod: (method: 'cash' | 'card' | 'split') => void
  cashReceived: string
  setCashReceived: (value: string) => void
  splitCash: string
  setSplitCash: (value: string) => void
  splitCard: string
  setSplitCard: (value: string) => void
  roundingAccess: CashRoundingAccess
  roundedTotal: string
  setRoundedTotal: (value: string) => void
  roundingReason: string
  setRoundingReason: (value: string) => void
  roundingApplied: boolean
  roundingInvalid: boolean
  roundingDifference: number
  total: number
  checkoutTotal: number
  cashInsufficient: boolean
  changeDue: number
  discountType: DiscountType
  setDiscountType: (type: DiscountType) => void
  discountValue: string
  setDiscountValue: (value: string) => void
  discountsEnabled: boolean
  discountOverLimit: boolean
  maxDiscountPct: number | undefined
  customerName: string
  setCustomerName: (value: string) => void
  customerPhone: string
  setCustomerPhone: (value: string) => void
  customerAddress: string
  setCustomerAddress: (value: string) => void
  deliveryFee: string
  setDeliveryFee: (value: string) => void
  subtotal: number
  discountAmt: number
  deliveryFeeNum: number
  taxAmt: number
  serviceAmt: number
  message: string
  loading: boolean
  onSubmit: () => void
  onSubmitUnpaid?: () => void
  onClose: () => void
}

export function CheckoutModal({
  orderType,
  checkoutMethod,
  setCheckoutMethod,
  cashReceived,
  setCashReceived,
  splitCash,
  setSplitCash,
  splitCard,
  setSplitCard,
  roundingAccess,
  roundedTotal,
  setRoundedTotal,
  roundingReason,
  setRoundingReason,
  roundingApplied,
  roundingInvalid,
  roundingDifference,
  total,
  checkoutTotal,
  cashInsufficient,
  changeDue,
  discountType,
  setDiscountType,
  discountValue,
  setDiscountValue,
  discountsEnabled,
  discountOverLimit,
  maxDiscountPct,
  customerName,
  setCustomerName,
  customerPhone,
  setCustomerPhone,
  customerAddress,
  setCustomerAddress,
  deliveryFee,
  setDeliveryFee,
  subtotal,
  discountAmt,
  deliveryFeeNum,
  taxAmt,
  serviceAmt,
  message,
  loading,
  onSubmit,
  onSubmitUnpaid,
  onClose
}: CheckoutModalProps): React.ReactElement {
  const canSubmitPaid = !loading && !cashInsufficient && !discountOverLimit && !roundingInvalid

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal checkout-modal" onClick={(e) => e.stopPropagation()}>
        <div className="order-details__header">
          <h2 className="order-details__title">إتمام الطلب</h2>
          <button type="button" className="order-details__close" onClick={onClose} aria-label="إغلاق">
            ×
          </button>
        </div>

        {(orderType === 'takeaway' || orderType === 'delivery') && (
          <div className="checkout-modal__section">
            <p className="checkout-modal__label">{orderType === 'delivery' ? 'الدفع الآن (اختياري)' : 'طريقة الدفع'}</p>
            <div className="order-type-toggle">
              {(['cash', 'card', 'split'] as const).map((method) => (
                <button
                  key={method}
                  type="button"
                  className={`order-type-toggle__btn${checkoutMethod === method ? ' order-type-toggle__btn--active' : ''}`}
                  onClick={() => {
                    setCheckoutMethod(method)
                    setCashReceived('')
                    if (method !== 'cash') {
                      setRoundedTotal('')
                      setRoundingReason('')
                    }
                  }}
                >
                  {method === 'cash' ? 'نقدي' : method === 'card' ? 'بطاقة' : 'تقسيم'}
                </button>
              ))}
            </div>

            {checkoutMethod === 'cash' && (
              <div className="checkout-modal__cash">
                {orderType === 'takeaway' && checkoutMethod === 'cash' && roundingAccess.enabled && (
                  <div className="checkout-modal__rounding">
                    <div className="checkout-modal__label">تقريب الدفع النقدي التلقائي</div>
                    {roundingApplied ? (
                      <div className="checkout-modal__readonly-summary">
                        <div><span>Original total</span><strong>{total.toFixed(2)}</strong></div>
                        <div><span>Cash rounding</span><strong>- {roundingDifference.toFixed(2)}</strong></div>
                        <div><span>Final total</span><strong>{checkoutTotal.toFixed(2)}</strong></div>
                      </div>
                    ) : (
                      <p className="modal-hint m-0">
                        {roundingAccess.allowed
                          ? `لا يوجد تقريب قابل للتطبيق داخل الحد المسموح (${roundingAccess.maxDifference.toFixed(2)})`
                          : roundingAccess.reason}
                      </p>
                    )}
                  </div>
                )}

                <label className="field m-0">
                  <span>المبلغ المستلم من العميل</span>
                  <input
                    type="number"
                    min={checkoutTotal}
                    step="0.01"
                    value={cashReceived}
                    onChange={(event) => setCashReceived(event.target.value)}
                    placeholder={total.toFixed(2)}
                    autoFocus
                    className={cashInsufficient ? 'input-danger' : undefined}
                  />
                </label>
                {cashInsufficient && (
                  <p className="form-error mt-4">المبلغ المستلم أقل من الإجمالي</p>
                )}
                {cashReceived.trim() !== '' && !cashInsufficient && changeDue >= 0 && (
                  <div className="checkout-modal__change">
                    <span>الباقي للعميل</span>
                    <strong>{changeDue.toFixed(2)}</strong>
                  </div>
                )}
              </div>
            )}

            {checkoutMethod === 'split' && (
              <div className="checkout-modal__split">
                <label className="field m-0">
                  <span>نقدي</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={splitCash}
                    onChange={(event) => setSplitCash(event.target.value)}
                    placeholder="0.00"
                  />
                </label>
                <label className="field m-0">
                  <span>بطاقة</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={splitCard}
                    onChange={(event) => setSplitCard(event.target.value)}
                    placeholder="0.00"
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {discountsEnabled && (
          <div className="checkout-modal__section">
            <p className="checkout-modal__label">خصم (اختياري)</p>
            <div className="checkout-modal__discount">
              <select value={discountType} onChange={(event) => setDiscountType(event.target.value as DiscountType)}>
                <option value="percent">نسبة %</option>
                <option value="fixed">مبلغ ثابت</option>
              </select>
              <input
                type="number"
                min="0"
                step="0.01"
                value={discountValue}
                onChange={(event) => setDiscountValue(event.target.value)}
                placeholder={discountType === 'percent' ? '10' : '5.00'}
                className={discountOverLimit ? 'input-danger' : undefined}
              />
            </div>
            {discountOverLimit && (
              <div className="checkout-modal__warning">
                Maximum allowed discount is {maxDiscountPct}%
              </div>
            )}
          </div>
        )}

        {orderType === 'delivery' && (
          <div className="checkout-modal__section">
            <p className="checkout-modal__label">بيانات التوصيل</p>
            <label className="field">
              <span>اسم العميل</span>
              <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="اسم العميل" />
            </label>
            <label className="field">
              <span>رقم الهاتف</span>
              <input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="01xxxxxxxxx" dir="ltr" />
            </label>
            <label className="field">
              <span>العنوان</span>
              <input value={customerAddress} onChange={(event) => setCustomerAddress(event.target.value)} placeholder="العنوان التفصيلي" />
            </label>
            <label className="field">
              <span>رسوم التوصيل</span>
              <input type="number" min="0" step="0.01" value={deliveryFee} onChange={(event) => setDeliveryFee(event.target.value)} placeholder="0.00" />
            </label>
          </div>
        )}

        <div className="checkout-modal__summary">
          {subtotal !== total && (
            <div><span>المجموع الفرعي</span><span>{subtotal.toFixed(2)}</span></div>
          )}
          {discountAmt > 0 && (
            <div className="checkout-modal__summary-danger"><span>خصم</span><span>- {discountAmt.toFixed(2)}</span></div>
          )}
          {deliveryFeeNum > 0 && (
            <div><span>رسوم التوصيل</span><span>{deliveryFeeNum.toFixed(2)}</span></div>
          )}
          {taxAmt > 0 && (
            <div><span>الضريبة</span><span>{taxAmt.toFixed(2)}</span></div>
          )}
          {serviceAmt > 0 && (
            <div><span>الخدمة</span><span>{serviceAmt.toFixed(2)}</span></div>
          )}
          {roundingApplied && !roundingInvalid && (
            <div className="checkout-modal__summary-danger"><span>تسوية تقريب نقدي</span><span>- {roundingDifference.toFixed(2)}</span></div>
          )}
          <div className="checkout-modal__summary-total">
            <span>الإجمالي</span>
            <strong>{checkoutTotal.toFixed(2)}</strong>
          </div>
        </div>

        {message && <p className="form-error">{message}</p>}

        <div className={`modal-actions${orderType === 'delivery' ? ' modal-actions--stacked' : ''}`}>
          {orderType === 'delivery' && onSubmitUnpaid && (
            <button
              type="button"
              className="btn btn--primary"
              disabled={loading || discountOverLimit}
              onClick={onSubmitUnpaid}
            >
              {loading ? 'جارٍ...' : 'حفظ كغير مدفوع'}
            </button>
          )}
          <button
            type="button"
            className={orderType === 'delivery' ? 'btn btn--secondary' : 'btn btn--primary'}
            disabled={!canSubmitPaid}
            onClick={onSubmit}
          >
            {loading ? 'جارٍ...' : orderType === 'delivery' ? 'تحصيل الآن' : 'تأكيد الطلب'}
          </button>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  )
}
