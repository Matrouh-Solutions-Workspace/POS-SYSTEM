/**
 * Shared UI component library — barrel export.
 *
 * Import all shared primitives from `@renderer/components/ui`.
 */

// Layout
export { Modal, type ModalProps } from './Modal'
export { FormModal, type FormModalProps } from './FormModal'
export { FormField, FormCheckbox, type FormFieldProps } from './FormField'
export { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog'

// Data display
export { DataTable, type DataTableColumn, type DataTableProps } from './DataTable'
export { StatCard, StatGrid, type StatCardProps } from './StatCard'
export { Badge, type BadgeProps } from './Badge'
export { EmptyState, type EmptyStateProps } from './EmptyState'

// Input
export { SearchInput, type SearchInputProps } from './SearchInput'
export { FilterBar, FilterSelect, FilterDate } from './FilterBar'

// Feedback
export { LoadingSpinner, type LoadingSpinnerProps } from './LoadingSpinner'
export { ToastContainer, showToast, type ToastType } from './Toast'
