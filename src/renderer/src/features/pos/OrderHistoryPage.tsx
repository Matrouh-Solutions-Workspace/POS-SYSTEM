/**
 * Order History — REQ-4 (Refund), REQ-5 (Reprint copy), REQ-13 (no window.confirm/prompt)
 */
import { useEffect, useState } from 'react'
import type { Order, OrderItem } from '@shared/types'
import { ConfirmDialog } from '@renderer/components/ui'
import {
  cancelOrder,
  getOrderItems,
  getSettings,
  listOrders,
  markOrderPaid,
  editOrderItems,
  refundOrder,
  type CartLine,
  type RefundLine
} from '@renderer/features/orders/order-service'
import { printReceipt } from '@renderer/features/receipt/receipt-builder'
import { orderReference } from '@shared/services/order-reference'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { getOpenShiftForCashier } from '@renderer/features/shifts/shift-service'
import {
  calculateAutomaticCashRounding,
  getCashRoundingAccess,
  type CashRoundingAccess
} from '@renderer/features/rounding/cash-rounding-service'

// ── helpers ──────────────────────────────────────────────────────────────

function isOrderUnpaid(order: Order): boolean {
  return order.status === 'draft' || order.paymentStatus === 'unpaid'
}

function orderStatusLabel(order: Order): string {
  if (order.status === 'cancelled') {
    if (order.orderCode?.startsWith('RFD-')) return 'استرداد'
    return 'ملغي'
  }
  if (order.paymentStatus === 'split') return 'تقسيم'
  return isOrderUnpaid(order) ? 'غير مدفوع' : 'مدفوع'
}

function orderStatusClass(order: Order): string {
  if (order.status === 'cancelled') return order.orderCode?.startsWith('RFD-') ? ' order-status-pill--refund' : ' order-status-pill--cancelled'
  if (isOrderUnpaid(order)) return ' order-status-pill--unpaid'
  return ''
}

function orderPlaceLabel(order: Order): string {
  if (order.orderType === 'delivery') return `دليفري${order.customerName ? ` — ${order.customerName}` : ''}`
  if (!order.tableNameAr) return 'تيك أواي'
  return `${order.tableNameAr}${order.tableCategoryAr ? ` - ${order.tableCategoryAr}` : ''}`
}

// ── Cancel modal — REQ-13 (no window.confirm/prompt) ────────────────────

function CancelModal({
  order,
  onConfirm,
  onCancel
}: {
  order: Order
  onConfirm: (inventoryMode: 'return' | 'waste', reason: string) => void
  onCancel: () => void
}): React.ReactElement {
  const [reason, setReason] = useState('')
  const [inventoryMode, setInventoryMode] = useState<'return' | 'waste'>('return')

  return (
    <ConfirmDialog
      open
      onCancel={onCancel}
      onConfirm={() => onConfirm(inventoryMode, reason)}
      title={`إلغاء طلب #${orderReference(order)}`}
      message=""
      confirmLabel="تأكيد الإلغاء"
      cancelLabel="تراجع"
      danger
    >
      <label className="field">
        <span>سبب الإلغاء (اختياري)</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="أدخل سبب الإلغاء..."
          autoFocus
        />
      </label>

      <div className="mb-16">
        <p style={{ fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>المخزون بعد الإلغاء:</p>
        <div className="order-type-toggle">
          <button
            type="button"
            className={`order-type-toggle__btn${inventoryMode === 'return' ? ' order-type-toggle__btn--active' : ''}`}
            onClick={() => setInventoryMode('return')}
          >
            يرجع للمخزون
          </button>
          <button
            type="button"
            className={`order-type-toggle__btn${inventoryMode === 'waste' ? ' order-type-toggle__btn--active' : ''}`}
            onClick={() => setInventoryMode('waste')}
          >
            هدر (لا يرجع)
          </button>
        </div>
      </div>
    </ConfirmDialog>
  )
}

// ── Refund modal — REQ-4 ─────────────────────────────────────────────────

function RefundModal({
  order,
  items,
  onConfirm,
  onCancel,
  saving
}: {
  order: Order
  items: OrderItem[]
  onConfirm: (lines: RefundLine[], reason: string) => void
  onCancel: () => void
  saving: boolean
}): React.ReactElement {
  const [selected, setSelected] = useState<Set<string>>(new Set(items.map((i) => i.id)))
  const [reason, setReason] = useState('')

  const selectedItems = items.filter((i) => selected.has(i.id))
  const refundSubtotal = selectedItems.reduce((s, i) => s + i.lineTotal, 0)
  // Proportional discount/tax
  const originalSubtotal = order.subtotal > 0 ? order.subtotal : 1
  const ratio = refundSubtotal / originalSubtotal
  const refundDiscount = Math.round((order.discountAmount ?? 0) * ratio * 100) / 100
  const refundTax = Math.round((order.taxAmount ?? 0) * ratio * 100) / 100
  const refundTotal = Math.max(0, refundSubtotal - refundDiscount + refundTax)

  function toggleItem(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleConfirm(): void {
    if (!reason.trim()) return
    const lines: RefundLine[] = selectedItems.map((i) => ({
      orderItemId: i.id,
      menuItemId: i.menuItemId,
      nameAr: i.nameAr,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      lineTotal: i.lineTotal
    }))
    onConfirm(lines, reason)
  }

  return (
    <ConfirmDialog
      open
      onCancel={onCancel}
      onConfirm={handleConfirm}
      title={`استرداد طلب #${orderReference(order)}`}
      message="اختر الأصناف المراد استردادها"
      confirmLabel={`تأكيد الاسترداد (${refundTotal.toFixed(2)})`}
      cancelLabel="إلغاء"
      danger
      loading={saving || selected.size === 0 || !reason.trim()}
    >
      <table className="data-table mb-12">
        <thead>
          <tr>
            <th style={{ width: 36 }}></th>
            <th>الصنف</th>
            <th>الكمية</th>
            <th>الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} style={{ opacity: selected.has(item.id) ? 1 : 0.45 }}>
              <td>
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggleItem(item.id)}
                />
              </td>
              <td>
                {item.nameAr}
                {item.sizeLabelAr && (
                  <span style={{ color: 'var(--color-muted)', fontSize: '0.78rem', marginInlineStart: 4 }}>
                    ({item.sizeLabelAr})
                  </span>
                )}
              </td>
              <td>{item.quantity}</td>
              <td>{item.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Refund amount summary */}
      <div style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-light)',
        borderRadius: 4,
        padding: '10px 14px',
        marginBottom: 14,
        fontSize: '0.88rem'
      }}>
        {refundDiscount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-muted)' }}>
            <span>خصم نسبي</span><span>-{refundDiscount.toFixed(2)}</span>
          </div>
        )}
        {refundTax > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-muted)' }}>
            <span>ضريبة نسبية</span><span>+{refundTax.toFixed(2)}</span>
          </div>
        )}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontWeight: 900,
          fontSize: '1.05rem',
          borderTop: '2px solid var(--color-border)',
          marginTop: 6,
          paddingTop: 6,
          color: 'var(--color-danger)'
        }}>
          <span>مبلغ الاسترداد</span>
          <span>{refundTotal.toFixed(2)}</span>
        </div>
      </div>

      <label className="field">
        <span>سبب الاسترداد <span className="text-danger">*</span></span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="أدخل سبب الاسترداد..."
          autoFocus
        />
      </label>
      {!reason.trim() && (
        <p style={{ fontSize: '0.8rem', color: 'var(--color-danger)', margin: '4px 0 0' }}>
          سبب الاسترداد مطلوب
        </p>
      )}
    </ConfirmDialog>
  )
}

// ── Main page ────────────────────────────────────────────────────────────

export function OrderHistoryPage(): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'ok' | 'error'>('ok')

  // Details modal
  const [details, setDetails] = useState<{ order: Order; items: OrderItem[] } | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)

  // Cancel modal — REQ-13
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null)

  // Split payment modal
  const [splitModal, setSplitModal] = useState<Order | null>(null)
  const [splitCash, setSplitCash] = useState('')
  const [splitCard, setSplitCard] = useState('')
  const [cashPaymentTarget, setCashPaymentTarget] = useState<Order | null>(null)
  const [cashReceived, setCashReceived] = useState('')
  const [cashRoundingAccess, setCashRoundingAccess] = useState<CashRoundingAccess>({
    enabled: false,
    allowed: false,
    maxDifference: 0,
    increment: 1
  })

  // Edit order modal
  const [editModal, setEditModal] = useState<{ order: Order; items: OrderItem[] } | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  // Refund modal — REQ-4
  const [refundModal, setRefundModal] = useState<{ order: Order; items: OrderItem[] } | null>(null)
  const [refundSaving, setRefundSaving] = useState(false)

  const currency = 'ج.م'
  const canVoidOrRefund = user.role === 'manager'

  async function load(): Promise<void> {
    const [loaded, shift] = await Promise.all([listOrders(300), getOpenShiftForCashier(user.id)])
    setOrders(shift ? loaded.filter((order) => order.shiftId === shift.id) : [])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  function showMsg(text: string, type: 'ok' | 'error' = 'ok'): void {
    setMessage(text)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  async function openDetails(order: Order): Promise<void> {
    setLoadingDetails(true)
    const items = await getOrderItems(order.id)
    setDetails({ order, items })
    setLoadingDetails(false)
  }

  // REQ-5 — Reprint with copy label
  async function reprint(order: Order): Promise<void> {
    const [items, settings] = await Promise.all([getOrderItems(order.id), getSettings()])
    await printReceipt(order, items, settings, { isCopy: true, label: '— نسخة —' })
  }

  // REQ-13 — Cancel uses modal, not window.confirm/prompt
  async function handleCancel(inventoryMode: 'return' | 'waste', reason: string): Promise<void> {
    if (!cancelTarget) return
    try {
      await cancelOrder({
        orderId: cancelTarget.id,
        cancelledBy: user.id,
        reasonAr: reason || undefined,
        inventoryMode
      })
      showMsg('تم إلغاء الطلب')
    } catch (e) {
      showMsg(e instanceof Error ? e.message : 'فشل الإلغاء', 'error')
    } finally {
      setCancelTarget(null)
      await load()
    }
  }

  async function handleMarkPaid(order: Order, method: 'cash' | 'card'): Promise<void> {
    try {
      const paid = await markOrderPaid({ orderId: order.id, cashierId: user.id, paymentMethod: method })
      if (!paid) return
      const [items, settings] = await Promise.all([getOrderItems(paid.id), getSettings()])
      showMsg('تم تسجيل الدفع')
      await load()
      printReceipt(paid, items, settings).catch(() => {})
    } catch (e) {
      showMsg(e instanceof Error ? e.message : 'فشل تسجيل الدفع', 'error')
    }
  }

  async function openCashPayment(order: Order): Promise<void> {
    setCashRoundingAccess(await getCashRoundingAccess(user))
    setCashPaymentTarget(order)
    setCashReceived('')
  }

  async function confirmCashPayment(): Promise<void> {
    if (!cashPaymentTarget) return
    const automaticRounding = calculateAutomaticCashRounding(cashPaymentTarget.total, cashRoundingAccess)
    const target = automaticRounding?.finalAmount ?? cashPaymentTarget.total
    const received = cashReceived.trim() ? Number(cashReceived) : target
    if (!Number.isFinite(received) || received < target) {
      showMsg('المبلغ المستلم أقل من إجمالي الطلب', 'error')
      return
    }
    try {
      const paid = await markOrderPaid({
        orderId: cashPaymentTarget.id,
        cashierId: user.id,
        paymentMethod: 'cash',
        cashReceived: received,
        roundedTotal: automaticRounding ? target : undefined,
        roundingReason: automaticRounding ? 'تقريب نقدي تلقائي' : undefined
      })
      if (!paid) return
      const [items, settings] = await Promise.all([getOrderItems(paid.id), getSettings()])
      setCashPaymentTarget(null)
      showMsg('تم تسجيل الدفع النقدي')
      await load()
      printReceipt(paid, items, settings).catch(() => {})
    } catch (cause) {
      showMsg(cause instanceof Error ? cause.message : 'فشل تسجيل الدفع', 'error')
    }
  }

  async function handleSplitPay(): Promise<void> {
    if (!splitModal) return
    const cash = Number(splitCash) || 0
    const card = Number(splitCard) || 0
    if (cash + card < splitModal.total - 0.01) {
      showMsg('مجموع الدفع أقل من الإجمالي', 'error')
      return
    }
    try {
      const paid = await markOrderPaid({
        orderId: splitModal.id,
        cashierId: user.id,
        paymentMethod: 'split',
        cashPaid: cash,
        cardPaid: card
      })
      if (!paid) return
      const [items, settings] = await Promise.all([getOrderItems(paid.id), getSettings()])
      setSplitModal(null)
      setSplitCash('')
      setSplitCard('')
      showMsg('تم تسجيل الدفع المقسم')
      await load()
      printReceipt(paid, items, settings).catch(() => {})
    } catch (e) {
      showMsg(e instanceof Error ? e.message : 'فشل', 'error')
    }
  }

  const cashPaymentRounding = cashPaymentTarget
    ? calculateAutomaticCashRounding(cashPaymentTarget.total, cashRoundingAccess)
    : null
  const cashPaymentFinalTotal = cashPaymentRounding?.finalAmount ?? cashPaymentTarget?.total ?? 0

  async function openEditModal(order: Order): Promise<void> {
    const items = await getOrderItems(order.id)
    setEditModal({ order, items })
  }

  function handleEditQtyChange(itemId: string, delta: number): void {
    setEditModal((prev) => {
      if (!prev) return prev
      const updated = prev.items
        .map((i) =>
          i.id === itemId
            ? { ...i, quantity: Math.max(0, i.quantity + delta), lineTotal: i.unitPrice * Math.max(0, i.quantity + delta) }
            : i
        )
        .filter((i) => i.quantity > 0)
      return { ...prev, items: updated }
    })
  }

  async function handleSaveEdit(): Promise<void> {
    if (!editModal) return
    setEditSaving(true)
    try {
      const lines: CartLine[] = editModal.items.map((i) => ({
        menuItemId: i.menuItemId,
        nameAr: i.nameAr,
        unitPrice: i.unitPrice,
        quantity: i.quantity,
        sizeLabelAr: i.sizeLabelAr,
        unitLabel: i.unitLabel,
        weightGrams: i.weightGrams,
        noteAr: i.noteAr
      }))
      await editOrderItems({ orderId: editModal.order.id, cashierId: user.id, lines, orderNoteAr: editModal.order.noteAr })
      setEditModal(null)
      showMsg('تم تعديل الطلب')
      await load()
    } catch (e) {
      showMsg(e instanceof Error ? e.message : 'فشل التعديل', 'error')
    } finally {
      setEditSaving(false)
    }
  }

  // REQ-4 — Refund
  async function openRefundModal(order: Order): Promise<void> {
    const items = await getOrderItems(order.id)
    // Exclude attachment lines from refund selection
    const refundableItems = items.filter((i) => !i.attachmentForMenuItemId)
    setRefundModal({ order, items: refundableItems })
  }

  async function handleRefund(lines: RefundLine[], reason: string): Promise<void> {
    if (!refundModal) return
    setRefundSaving(true)
    try {
      const { refundAmount } = await refundOrder({
        originalOrderId: refundModal.order.id,
        cashierId: user.id,
        cashierName: user.displayName,
        lines,
        reasonAr: reason
      })
      setRefundModal(null)
      showMsg(`تم الاسترداد بنجاح — ${refundAmount.toFixed(2)} ${currency}`)
      await load()
    } catch (e) {
      showMsg(e instanceof Error ? e.message : 'فشل الاسترداد', 'error')
    } finally {
      setRefundSaving(false)
    }
  }

  if (loading) return <p className="app-loading">جاري التحميل...</p>

  const visibleOrders = orders.filter((o) => !o.archived)

  return (
    <>
      {/* Cancel modal */}
      {cancelTarget && (
        <CancelModal
          order={cancelTarget}
          onConfirm={(mode, reason) => void handleCancel(mode, reason)}
          onCancel={() => setCancelTarget(null)}
        />
      )}

      {/* Refund modal */}
      {refundModal && (
        <RefundModal
          order={refundModal.order}
          items={refundModal.items}
          onConfirm={(lines, reason) => void handleRefund(lines, reason)}
          onCancel={() => setRefundModal(null)}
          saving={refundSaving}
        />
      )}

      <div className="card">
        <h2 className="card__title">سجل الطلبات</h2>
        {message && (
          <p className={`form-message ${messageType === 'error' ? 'form-message--error' : 'form-message--ok'}`}>
            {message}
          </p>
        )}
        <table className="data-table">
          <thead>
            <tr>
              <th>رقم الطلب</th>
              <th>الحالة</th>
              <th>المكان</th>
              <th>التاريخ</th>
              <th>الكاشير</th>
              <th>الإجمالي</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleOrders.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--color-muted)' }}>
                  لا توجد طلبات
                </td>
              </tr>
            ) : (
              visibleOrders.map((order) => {
                const unpaid = isOrderUnpaid(order)
                const canEdit = order.status === 'draft' && order.paymentStatus === 'unpaid'
                const canRefund =
                  canVoidOrRefund &&
                  order.status === 'completed' &&
                  (order.paymentStatus === 'paid' || order.paymentStatus === 'split') &&
                  !order.orderCode?.startsWith('RFD-')
                const isRefundRecord = order.orderCode?.startsWith('RFD-')

                return (
                  <tr
                    key={order.id}
                    className={unpaid ? 'order-row--unpaid' : isRefundRecord ? 'order-row--refund' : ''}
                  >
                    <td>#{orderReference(order)}</td>
                    <td>
                      <span className={`order-status-pill${orderStatusClass(order)}`}>
                        {orderStatusLabel(order)}
                      </span>
                    </td>
                    <td>{orderPlaceLabel(order)}</td>
                    <td style={{ fontSize: '0.82rem' }}>
                      {new Date(order.completedAt ?? order.createdAt).toLocaleString('ar-EG')}
                    </td>
                    <td>{order.cashierName}</td>
                    <td>
                      {order.discountAmount && order.discountAmount > 0 ? (
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-danger)' }}>
                          خصم: -{order.discountAmount.toFixed(2)}
                        </div>
                      ) : null}
                      <span style={{ color: order.total < 0 ? 'var(--color-danger)' : undefined, fontWeight: order.total < 0 ? 700 : undefined }}>
                        {order.total.toFixed(2)} {currency}
                      </span>
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => void openDetails(order)}
                          disabled={loadingDetails}
                        >
                          تفاصيل
                        </button>

                        {/* REQ-5: Reprint button — one tap, copy label on receipt */}
                        {!unpaid && order.status !== 'cancelled' && (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => void reprint(order)}
                            title="طباعة نسخة من الإيصال"
                          >
                            طباعة
                          </button>
                        )}

                        {canEdit && (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => void openEditModal(order)}
                          >
                            تعديل
                          </button>
                        )}

                        {/* Mark paid buttons for unpaid orders */}
                        {unpaid && order.status !== 'cancelled' && (
                          <>
                            <button
                              type="button"
                              className="btn btn--primary btn--sm"
                              onClick={() => void openCashPayment(order)}
                            >
                              نقدي
                            </button>
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              onClick={() => void handleMarkPaid(order, 'card')}
                            >
                              بطاقة
                            </button>
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              onClick={() => { setSplitModal(order); setSplitCash(''); setSplitCard('') }}
                            >
                              تقسيم
                            </button>
                          </>
                        )}

                        {/* REQ-4: Refund button */}
                        {canRefund && (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm text-danger"
                            onClick={() => void openRefundModal(order)}
                          >
                            استرداد
                          </button>
                        )}

                        {/* Cancel button — REQ-13: opens modal, no window.confirm */}
                        {canVoidOrRefund && order.status !== 'cancelled' && !isRefundRecord && (
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            onClick={() => setCancelTarget(order)}
                          >
                            إلغاء
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Details modal ── */}
      {details && (
        <div className="modal-overlay" onClick={() => setDetails(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="order-details__header">
              <h2 className="order-details__title">طلب #{orderReference(details.order)}</h2>
              <button type="button" className="order-details__close" onClick={() => setDetails(null)}>✕</button>
            </div>
            <div className="order-details__meta">
              <div className="order-details__meta-row">
                <span className="order-details__meta-label">التاريخ</span>
                <span>{new Date(details.order.completedAt ?? details.order.createdAt).toLocaleString('ar-EG')}</span>
              </div>
              <div className="order-details__meta-row">
                <span className="order-details__meta-label">الكاشير</span>
                <span>{details.order.cashierName}</span>
              </div>
              <div className="order-details__meta-row">
                <span className="order-details__meta-label">النوع</span>
                <span>{orderPlaceLabel(details.order)}</span>
              </div>
              {details.order.orderType === 'delivery' && details.order.customerPhone && (
                <div className="order-details__meta-row">
                  <span className="order-details__meta-label">هاتف العميل</span>
                  <span dir="ltr">{details.order.customerPhone}</span>
                </div>
              )}
              {details.order.orderType === 'delivery' && details.order.customerAddress && (
                <div className="order-details__meta-row">
                  <span className="order-details__meta-label">العنوان</span>
                  <span>{details.order.customerAddress}</span>
                </div>
              )}
              {details.order.noteAr && (
                <div className="order-details__meta-row">
                  <span className="order-details__meta-label">ملاحظة</span>
                  <span>{details.order.noteAr}</span>
                </div>
              )}
              {details.order.cancelReasonAr && (
                <div className="order-details__meta-row">
                  <span className="order-details__meta-label">سبب الإلغاء / الاسترداد</span>
                  <span className="text-danger">{details.order.cancelReasonAr}</span>
                </div>
              )}
            </div>
            <table className="data-table mt-12">
              <thead>
                <tr><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr>
              </thead>
              <tbody>
                {details.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.nameAr}
                      {item.sizeLabelAr && (
                        <div className="text-xs text-muted">
                          {item.sizeLabelAr}
                        </div>
                      )}
                    </td>
                    <td>{Math.abs(item.quantity)}</td>
                    <td>{item.unitPrice.toFixed(2)} {currency}</td>
                    <td>{Math.abs(item.lineTotal).toFixed(2)} {currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="order-details__totals">
              {details.order.discountAmount ? (
                <div className="order-details__total-row text-danger">
                  <span>خصم</span>
                  <span>- {Math.abs(details.order.discountAmount).toFixed(2)} {currency}</span>
                </div>
              ) : null}
              {details.order.taxAmount ? (
                <div className="order-details__total-row">
                  <span>ضريبة ({details.order.taxRate}%)</span>
                  <span>{Math.abs(details.order.taxAmount).toFixed(2)} {currency}</span>
                </div>
              ) : null}
              {details.order.deliveryFee ? (
                <div className="order-details__total-row">
                  <span>رسوم التوصيل</span>
                  <span>{details.order.deliveryFee.toFixed(2)} {currency}</span>
                </div>
              ) : null}
              <div className="order-details__total-row">
                <span>الإجمالي</span>
                <strong style={{ color: details.order.total < 0 ? 'var(--color-danger)' : undefined }}>
                  {details.order.total.toFixed(2)} {currency}
                </strong>
              </div>
            </div>
            <div className="modal-actions mt-16">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => void reprint(details.order)}
              >
                طباعة الإيصال
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => setDetails(null)}
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Split payment modal ── */}
      {splitModal && (
        <div className="modal-overlay" onClick={() => setSplitModal(null)}>
          <div className="modal" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <div className="order-details__header">
              <h2 className="order-details__title">دفع مقسم — #{orderReference(splitModal)}</h2>
              <button type="button" className="order-details__close" onClick={() => setSplitModal(null)}>✕</button>
            </div>
            <p style={{ margin: '0 0 12px', fontWeight: 700 }}>
              الإجمالي: {splitModal.total.toFixed(2)} {currency}
            </p>
            <label className="field">
              <span>نقدي</span>
              <input type="number" min="0" step="0.01" value={splitCash} onChange={(e) => setSplitCash(e.target.value)} autoFocus />
            </label>
            <label className="field">
              <span>بطاقة</span>
              <input type="number" min="0" step="0.01" value={splitCard} onChange={(e) => setSplitCard(e.target.value)} />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn--primary" onClick={() => void handleSplitPay()}>
                تأكيد الدفع
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => setSplitModal(null)}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {cashPaymentTarget && (
        <div className="modal-overlay" onClick={() => setCashPaymentTarget(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(event) => event.stopPropagation()}>
            <div className="order-details__header">
              <h2 className="order-details__title">دفع نقدي — #{orderReference(cashPaymentTarget)}</h2>
              <button type="button" className="order-details__close" onClick={() => setCashPaymentTarget(null)}>×</button>
            </div>
            <p style={{ fontWeight: 800 }}>إجمالي الطلب: {cashPaymentTarget.total.toFixed(2)} {currency}</p>
            <label className="field">
              <span>المبلغ المستلم من العميل</span>
              <input type="number" min="0" step="0.01" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} placeholder={cashPaymentTarget.total.toFixed(2)} autoFocus />
            </label>
            {cashReceived && Number(cashReceived) >= cashPaymentFinalTotal && (
              <p className="form-message form-message--ok">
                الباقي للعميل: {(Number(cashReceived) - cashPaymentFinalTotal).toFixed(2)} {currency}
              </p>
            )}
            {cashRoundingAccess.enabled && (
              cashPaymentRounding ? (
                <div className="checkout-modal__readonly-summary">
                  <div><span>الإجمالي قبل التقريب</span><strong>{cashPaymentTarget.total.toFixed(2)}</strong></div>
                  <div><span>تقريب النقدية</span><strong>{cashPaymentRounding.differenceAmount > 0 ? '-' : '+'} {Math.abs(cashPaymentRounding.differenceAmount).toFixed(2)}</strong></div>
                  <div><span>الإجمالي النهائي</span><strong>{cashPaymentFinalTotal.toFixed(2)}</strong></div>
                </div>
              ) : <p className="modal-hint">{cashRoundingAccess.allowed ? `لا يوجد تقريب قابل للتطبيق داخل الحد المسموح (${cashRoundingAccess.maxDifference.toFixed(2)})` : cashRoundingAccess.reason}</p>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn--primary" onClick={() => void confirmCashPayment()}>تأكيد الدفع</button>
              <button type="button" className="btn btn--secondary" onClick={() => setCashPaymentTarget(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit order modal ── */}
      {editModal && (
        <div className="modal-overlay" onClick={() => setEditModal(null)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="order-details__header">
              <h2 className="order-details__title">تعديل طلب #{orderReference(editModal.order)}</h2>
              <button type="button" className="order-details__close" onClick={() => setEditModal(null)}>✕</button>
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--color-muted)', marginBottom: 12 }}>
              غيّر الكميات أو احذف أصنافاً ثم احفظ
            </p>
            <table className="data-table">
              <thead>
                <tr><th>الصنف</th><th>الكمية</th><th>الإجمالي</th><th></th></tr>
              </thead>
              <tbody>
                {editModal.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.nameAr}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button type="button" className="qty-btn" onClick={() => handleEditQtyChange(item.id, -1)}>-</button>
                        <span>{item.quantity}</span>
                        <button type="button" className="qty-btn" onClick={() => handleEditQtyChange(item.id, 1)}>+</button>
                      </div>
                    </td>
                    <td>{(item.unitPrice * item.quantity).toFixed(2)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        onClick={() => handleEditQtyChange(item.id, -item.quantity)}
                      >
                        حذف
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="modal-actions mt-16">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void handleSaveEdit()}
                disabled={editSaving || editModal.items.length === 0}
              >
                {editSaving ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => setEditModal(null)}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
