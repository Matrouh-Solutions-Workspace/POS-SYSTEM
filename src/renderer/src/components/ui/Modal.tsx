/**
 * Shared Modal component.
 *
 * Wraps the existing `.modal-overlay` + `.modal` CSS classes.
 * Provides a consistent header (title + close), body, and optional footer.
 */
import { useEffect, useRef, type ReactNode } from 'react'

export interface ModalProps {
  /** Whether the modal is visible */
  open: boolean
  /** Called when the user clicks the overlay or the close button */
  onClose: () => void
  /** Title displayed in the modal header */
  title: string
  /** Override the default max-width (520px) */
  maxWidth?: number
  /** Extra CSS class names on the .modal element */
  className?: string
  /** Body content */
  children: ReactNode
  /** Optional footer — usually action buttons */
  footer?: ReactNode
  /** If true, clicking the backdrop does NOT close the modal */
  persistent?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  maxWidth,
  className,
  children,
  footer,
  persistent
}: ModalProps): React.ReactElement | null {
  const modalRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  // Trap focus inside modal
  useEffect(() => {
    if (!open || !modalRef.current) return
    const firstFocusable = modalRef.current.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    firstFocusable?.focus()
  }, [open])

  if (!open) return null

  return (
    <div
      className="modal-overlay"
      onClick={persistent ? undefined : onClose}
    >
      <div
        ref={modalRef}
        className={`modal${className ? ` ${className}` : ''}`}
        style={maxWidth ? { maxWidth } : undefined}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Header */}
        <div className="order-details__header">
          <h2 className="order-details__title">{title}</h2>
          <button
            type="button"
            className="order-details__close"
            onClick={onClose}
            aria-label="إغلاق"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="modal__body">{children}</div>

        {/* Footer */}
        {footer && <div className="modal-actions">{footer}</div>}
      </div>
    </div>
  )
}
