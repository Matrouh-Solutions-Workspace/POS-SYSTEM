// ---------------------------------------------------------------------------
// Audit Log — REQ-7
// Every significant action in the system is recorded here.
// ---------------------------------------------------------------------------

export type AuditAction =
  | 'login'
  | 'logout'
  | 'order_cancelled'
  | 'order_created'
  | 'order_updated'
  | 'order_paid'
  | 'discount_applied'
  | 'manager_override_discount'
  | 'order_refunded'
  | 'account_created'
  | 'account_updated'
  | 'account_deactivated'
  | 'account_deleted'
  | 'settings_changed'
  | 'shift_opened'
  | 'shift_closed'
  | 'work_shift_created'
  | 'work_shift_updated'
  | 'work_shift_deleted'
  | 'shift_assignment_created'
  | 'shift_assignment_updated'
  | 'shift_assignment_deleted'
  | 'overtime_recorded'
  | 'shift_difference_approved'
  | 'cash_rounding_applied'
  | 'cash_in'
  | 'cash_out'
  | 'menu_category_created'
  | 'menu_category_updated'
  | 'menu_category_deleted'
  | 'menu_item_created'
  | 'menu_item_updated'
  | 'menu_item_deleted'
  | 'item_size_created'
  | 'item_size_updated'
  | 'item_size_deleted'
  | 'item_addon_created'
  | 'item_addon_updated'
  | 'item_addon_deleted'
  | 'ingredient_created'
  | 'ingredient_updated'
  | 'ingredient_deleted'
  | 'inventory_purchase'
  | 'inventory_waste'
  | 'inventory_adjustment'
  | 'supplier_created'
  | 'supplier_updated'
  | 'supplier_deleted'
  | 'supplier_transaction_recorded'
  | 'contact_created'
  | 'contact_updated'
  | 'contact_deleted'
  | 'kitchen_printer_created'
  | 'kitchen_printer_updated'
  | 'kitchen_printer_deleted'

export interface AuditEntry {
  id: string
  action: AuditAction
  actorId: string
  actorName: string
  /** ID of the entity this action was performed on (order, user, shift…) */
  targetId?: string
  /** Type of the target entity */
  targetType?:
    | 'order'
    | 'user'
    | 'shift'
    | 'work_shift'
    | 'shift_assignment'
    | 'settings'
    | 'cash'
    | 'menu_category'
    | 'menu_item'
    | 'item_size'
    | 'item_addon'
    | 'ingredient'
    | 'inventory'
    | 'supplier'
    | 'contact'
    | 'printer'
  /** Human-readable Arabic description of what happened */
  detailAr: string
  createdAt: number
}
