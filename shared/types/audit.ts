// ---------------------------------------------------------------------------
// Audit Log — REQ-7
// Every significant action in the system is recorded here.
// ---------------------------------------------------------------------------

export type AuditAction =
  | 'login'
  | 'logout'
  | 'order_cancelled'
  | 'discount_applied'
  | 'manager_override_discount'
  | 'order_refunded'
  | 'account_created'
  | 'account_deactivated'
  | 'account_deleted'
  | 'settings_changed'
  | 'shift_opened'
  | 'shift_closed'
  | 'cash_in'
  | 'cash_out'

export interface AuditEntry {
  id: string
  action: AuditAction
  actorId: string
  actorName: string
  /** ID of the entity this action was performed on (order, user, shift…) */
  targetId?: string
  /** Type of the target entity */
  targetType?: 'order' | 'user' | 'shift' | 'settings' | 'cash'
  /** Human-readable Arabic description of what happened */
  detailAr: string
  createdAt: number
}
