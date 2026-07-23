import { usePosStore } from '../pos-store'
import { lineTotal } from '@shared/services/order-calculator'
import { orderReference } from '@shared/services/order-reference'
import type { DiningTable, Order } from '@shared/types'

export interface CartPanelProps {
  posLogoUrl: string
  tables: DiningTable[]
  occupiedTableIds: Set<string>
  selectedTable: DiningTable | undefined
  setTablePopupOpen: (open: boolean) => void
  hasOpenShift: boolean
  handleCloseShift: () => void
  changeQty: (key: string, delta: number) => void
  discountAmt: number
  subtotal: number
  deliveryFeeNum: number
  total: number
  message: string
  editingOrder: Order | null
  setEditingOrder: (order: Order | null) => void
  loading: boolean
  submitEditOrder: () => void
  handleHoldOrder: () => void
  handleCheckout: (method?: 'cash' | 'card') => void
  setCheckoutMethod: (method: 'cash' | 'card' | 'split') => void
  setHeldPanelOpen: (open: boolean) => void
}

export function CartPanel({
  posLogoUrl,
  tables,
  occupiedTableIds,
  selectedTable,
  setTablePopupOpen,
  hasOpenShift,
  handleCloseShift,
  changeQty,
  discountAmt,
  subtotal,
  deliveryFeeNum,
  total,
  message,
  editingOrder,
  setEditingOrder,
  loading,
  submitEditOrder,
  handleHoldOrder,
  handleCheckout,
  setCheckoutMethod,
  setHeldPanelOpen
}: CartPanelProps): React.ReactElement {
  const { cart, orderType, setOrderType, orderNote, setOrderNote, heldOrders, setCart } = usePosStore()

  return (
    <aside className="pos-cart">
      <div className="pos-cart__header">
        <span>الطلب</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* REQ-3: Held orders badge — in header, always visible */}
          {heldOrders.length > 0 && (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              style={{ position: 'relative', paddingInlineEnd: 22 }}
              onClick={() => setHeldPanelOpen(true)}
              title="عرض الطلبات المعلقة"
            >
              معلقة
              <span style={{
                position: 'absolute',
                top: -6,
                insetInlineEnd: -6,
                background: 'var(--color-primary)',
                color: '#fff',
                borderRadius: '50%',
                width: 18,
                height: 18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.7rem',
                fontWeight: 900,
                lineHeight: 1
              }}>
                {heldOrders.length}
              </span>
            </button>
          )}
          <button
            type="button"
            className={`btn btn--sm pos-cart__shift-btn ${hasOpenShift ? 'btn--danger' : 'pos-cart__shift-btn--start'}`}
            onClick={handleCloseShift}
          >
            {hasOpenShift ? 'تقفيل شيفت' : 'بدء شيفت'}
          </button>
        </div>
      </div>

      {/* Order type toggle */}
      <div className="order-service-panel">
        <div className="order-type-toggle">
          {(['takeaway', 'dine_in', 'delivery'] as const).map((type) => (
            <button
              key={type}
              type="button"
              className={`order-type-toggle__btn${orderType === type ? ' order-type-toggle__btn--active' : ''}`}
              onClick={() => setOrderType(type)}
            >
              {type === 'takeaway' ? 'تيك أواي' : type === 'dine_in' ? 'صالة' : 'دليفري'}
            </button>
          ))}
        </div>
        {orderType === 'dine_in' && (
          <button
            type="button"
            className={`table-picker-trigger${selectedTable ? ' table-picker-trigger--selected' : ''}${selectedTable && occupiedTableIds.has(selectedTable.id) ? ' table-picker-trigger--occupied' : ''}`}
            onClick={() => setTablePopupOpen(true)}
          >
            <span>الترابيزة</span>
            <strong>
              {selectedTable
                ? `${selectedTable.nameAr}${selectedTable.categoryAr ? ` - ${selectedTable.categoryAr}` : ''}`
                : tables.length ? 'اختيار ترابيزة' : 'لا توجد ترابيزات'}
            </strong>
          </button>
        )}
      </div>

      {/* Cart lines */}
      <div className="pos-cart__lines">
        {cart.length === 0 && (
          <div className="pos-cart__empty">
            <img src={posLogoUrl} alt="شعار المطعم" className="pos-cart__logo" />
            <p className="pos-cart__empty-text">أضف أصنافًا من القائمة</p>
          </div>
        )}
        {cart.map((line) => (
          <div key={line.key} className={`cart-line${line.parentKey ? ' cart-line--attachment' : ''}`}>
            <div>
              <div className="cart-line__name">{line.nameAr}</div>
              <div>
                {lineTotal(line.unitPrice, line.quantity).toFixed(2)}
                {line.sizeLabelAr && (
                  <span style={{ color: 'var(--color-muted)', marginInlineStart: 6 }}>
                    ({line.sizeLabelAr})
                  </span>
                )}
                {line.unitLabel && (
                  <span style={{ color: 'var(--color-muted)', marginInlineStart: 6 }}>
                    ({line.quantity.toFixed(3)} {line.unitLabel})
                  </span>
                )}
              </div>
            </div>
            <div className="cart-line__controls">
              {!line.parentKey && (
                <button type="button" className="qty-btn" onClick={() => changeQty(line.key, -1)}>
                  -
                </button>
              )}
              <span>{line.unitLabel ? line.quantity.toFixed(2) : line.quantity}</span>
              {!line.parentKey && (
                <button type="button" className="qty-btn" onClick={() => changeQty(line.key, 1)}>
                  +
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="pos-cart__footer">
        <textarea
          className="order-note"
          placeholder="ملاحظة على الطلب..."
          value={orderNote}
          onChange={(e) => setOrderNote(e.target.value)}
        />

        {/* Cart totals summary */}
        <div className="cart-summary">
          {discountAmt > 0 && (
            <div style={{ fontSize: '0.82rem', color: 'var(--color-muted)' }}>
              <span>المجموع الفرعي</span>
              <span className="mis-8">{subtotal.toFixed(2)}</span>
            </div>
          )}
          {discountAmt > 0 && (
            <div style={{ fontSize: '0.82rem', color: 'var(--color-danger)' }}>
              <span>خصم</span>
              <span className="mis-8">- {discountAmt.toFixed(2)}</span>
            </div>
          )}
          {deliveryFeeNum > 0 && (
            <div style={{ fontSize: '0.82rem', color: 'var(--color-muted)' }}>
              <span>رسوم التوصيل</span>
              <span className="mis-8">{deliveryFeeNum.toFixed(2)}</span>
            </div>
          )}
          <div>
            <span>الإجمالي</span>
            <strong>{total.toFixed(2)}</strong>
          </div>
        </div>

        {message && (
          <p className={`form-message ${message.includes('فشل') || message.includes('أقل') ? 'form-message--error' : 'form-message--ok'}`}>
            {message}
          </p>
        )}

        {/* Edit mode banner */}
        {editingOrder && (
          <div style={{
            background: '#fef3c7',
            border: '2px solid #f59e0b',
            padding: '6px 10px',
            marginBottom: 8,
            fontSize: '0.82rem',
            fontWeight: 700
          }}>
            وضع تعديل طلب #{orderReference(editingOrder)}
            <button
              type="button"
              className="btn btn--secondary btn--sm mis-8"
              onClick={() => { setEditingOrder(null); setCart([]); setOrderNote('') }}
            >
              إلغاء
            </button>
          </div>
        )}

        {/* Checkout actions */}
        <div className="checkout-actions">
          {editingOrder ? (
            <button
              type="button"
              className="btn btn--primary"
              disabled={loading || cart.length === 0}
              onClick={() => void submitEditOrder()}
            >
              {loading ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
            </button>
          ) : orderType === 'takeaway' ? (
            <>
              {cart.length > 0 && (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm checkout-actions__hold"
                  onClick={handleHoldOrder}
                  title="تعليق الطلب الحالي واستئنافه لاحقاً"
                >
                  تعليق الطلب
                </button>
              )}
              <div className="checkout-actions__payments">
                <button
                  type="button"
                  className="btn btn--primary checkout-actions__payment checkout-actions__payment--main"
                  disabled={loading || cart.length === 0}
                  onClick={() => handleCheckout('cash')}
                >
                  نقدي
                </button>
                <button
                  type="button"
                  className="btn btn--secondary checkout-actions__payment"
                  disabled={loading || cart.length === 0}
                  onClick={() => handleCheckout('card')}
                >
                  بطاقة
                </button>
                <button
                  type="button"
                  className="btn btn--secondary checkout-actions__payment"
                  disabled={loading || cart.length === 0}
                  onClick={() => {
                    setCheckoutMethod('split')
                    handleCheckout()
                  }}
                >
                  تقسيم
                </button>
              </div>
            </>
          ) : orderType === 'dine_in' ? (
            <>
              {cart.length > 0 && (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  style={{ width: '100%', marginBottom: 6, opacity: 0.75, fontSize: '0.82rem' }}
                  onClick={handleHoldOrder}
                  title="تعليق الطلب الحالي"
                >
                  ⏸ تعليق الطلب
                </button>
              )}
              <button
                type="button"
                className="btn btn--primary"
                style={{ width: '100%' }}
                disabled={loading || cart.length === 0 || !selectedTable}
                onClick={() => handleCheckout()}
              >
                {loading ? 'جارٍ...' : 'إنشاء طلب صالة'}
              </button>
            </>
          ) : (
            <>
              {cart.length > 0 && (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  style={{ width: '100%', marginBottom: 6, opacity: 0.75, fontSize: '0.82rem' }}
                  onClick={handleHoldOrder}
                  title="تعليق الطلب الحالي"
                >
                  ⏸ تعليق الطلب
                </button>
              )}
              <button
                type="button"
                className="btn btn--primary"
                style={{ width: '100%' }}
                disabled={loading || cart.length === 0}
                onClick={() => handleCheckout()}
              >
                {loading ? 'جارٍ...' : 'إنشاء طلب دليفري'}
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  )
}
