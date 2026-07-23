/**
 * ConfirmDialog — consistent confirmation modal replacing window.confirm().
 *
 * Shows a message and confirm/cancel buttons with customizable labels and styles.
 */
import { Modal } from './Modal'

export interface ConfirmDialogProps {
  /** Whether the dialog is visible */
  open: boolean
  /** Called when confirmed */
  onConfirm: () => void
  /** Called when cancelled or closed */
  onCancel: () => void
  /** Dialog title */
  title: string
  /** Message body */
  message?: React.ReactNode
  /** Label for the confirm button — defaults to "تأكيد" */
  confirmLabel?: string
  /** Label for the cancel button — defaults to "إلغاء" */
  cancelLabel?: string
  /** Use danger styling for the confirm button */
  danger?: boolean
  /** Whether the confirm button is disabled (e.g., during async action) */
  loading?: boolean
  /** Optional custom content below the message */
  children?: React.ReactNode
}

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  danger = false,
  loading = false,
  children
}: ConfirmDialogProps): React.ReactElement | null {
  if (!open) return null

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      maxWidth={400}
      footer={
        <>
          <button
            type="button"
            className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'جارٍ...' : confirmLabel}
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </button>
        </>
      }
    >
      {message && <p className="m-0 text-sm leading-relaxed">{message}</p>}
      {children}
    </Modal>
  )
}
