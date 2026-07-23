import type { HeldOrder } from '../pos-store'

export interface HeldOrdersPanelProps {
  heldOrders: HeldOrder[]
  onResume: (held: HeldOrder) => void
  onDiscard: (id: string) => void
  onClose: () => void
}

export function HeldOrdersPanel({
  heldOrders,
  onResume,
  onDiscard,
  onClose
}: HeldOrdersPanelProps): React.ReactElement {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal held-orders-panel" onClick={(event) => event.stopPropagation()}>
        <div className="order-details__header">
          <h2 className="order-details__title">الطلبات المعلقة ({heldOrders.length})</h2>
          <button type="button" className="order-details__close" onClick={onClose} aria-label="إغلاق">
            ×
          </button>
        </div>

        <p className="held-orders-panel__hint">
          اختر طلبًا لاستعادته إلى السلة، أو احذفه لو لم تعد تحتاجه.
        </p>

        <div className="held-orders-panel__list">
          {heldOrders.length === 0 && (
            <div className="held-orders-panel__empty">لا توجد طلبات معلقة الآن</div>
          )}
          {heldOrders.map((held) => (
            <div key={held.id} className="held-orders-panel__row">
              <div>
                <div className="held-orders-panel__title">{held.label}</div>
                <div className="held-orders-panel__meta">
                  {held.cart.filter((line) => !line.parentKey).length} صنف
                </div>
              </div>
              <div className="held-orders-panel__actions">
                <button type="button" className="btn btn--primary btn--sm" onClick={() => onResume(held)}>
                  استعادة
                </button>
                <button type="button" className="btn btn--danger btn--sm" onClick={() => onDiscard(held.id)}>
                  حذف
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
