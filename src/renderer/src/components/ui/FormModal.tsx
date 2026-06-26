/**
 * FormModal — create/edit modal with consistent layout, validation, and save/cancel actions.
 *
 * Combines Modal with a standard form layout:
 * - Title changes between "إضافة" (create) and "تعديل" (edit)
 * - Save and Cancel buttons in footer
 * - Loading state on save
 * - Error/success message display
 */
import { useState, type FormEvent, type ReactNode } from 'react'
import { Modal } from './Modal'

export interface FormModalProps {
  /** Whether the modal is visible */
  open: boolean
  /** Called to close the modal */
  onClose: () => void
  /** Entity name in Arabic, e.g. "صنف", "تصنيف", "مورد" */
  entityName: string
  /** Whether this is editing an existing entity (changes title to تعديل) */
  isEdit?: boolean
  /** Custom title override (replaces the auto-generated إضافة/تعديل title) */
  title?: string
  /** Called when the form is submitted. Return false to prevent the modal from closing automatically. */
  onSubmit: (e?: FormEvent) => Promise<void | boolean>
  /** Label for the save button — defaults to "حفظ" */
  saveLabel?: string
  /** Whether the save button should be disabled */
  saveDisabled?: boolean
  /** Override max width */
  maxWidth?: number
  /** Extra buttons to display in the footer, placed before standard buttons */
  extraFooterButtons?: ReactNode
  /** Form body content */
  children: ReactNode
}

export function FormModal({
  open,
  onClose,
  entityName,
  isEdit = false,
  title: customTitle,
  onSubmit,
  saveLabel,
  saveDisabled,
  maxWidth = 520,
  extraFooterButtons,
  children
}: FormModalProps): React.ReactElement | null {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const title = customTitle ?? (isEdit ? `تعديل ${entityName}` : `إضافة ${entityName}`)
  const submitLabel = saveLabel ?? (loading ? 'جارٍ الحفظ...' : 'حفظ')

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const shouldClose = await onSubmit(e)
      if (shouldClose !== false) {
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ')
    } finally {
      setLoading(false)
    }
  }

  function handleClose(): void {
    if (loading) return
    setError('')
    onClose()
  }

  if (!open) return null

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      maxWidth={maxWidth}
      persistent={loading}
      footer={
        <>
          {extraFooterButtons}
          <button
            type="submit"
            form="form-modal-form"
            className="btn btn--primary"
            disabled={loading || saveDisabled}
          >
            {submitLabel}
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={handleClose}
            disabled={loading}
          >
            إلغاء
          </button>
        </>
      }
    >
      {error && <p className="form-message form-message--error">{error}</p>}
      <form
        id="form-modal-form"
        onSubmit={(e) => void handleSubmit(e)}
      >
        {children}
      </form>
    </Modal>
  )
}
