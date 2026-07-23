/**
 * FormField — consistent label + input + error message + hint wrapper.
 *
 * Wraps the existing `.field` CSS class pattern and provides a standard API
 * for all form inputs across the application.
 */
import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

export interface FormFieldProps {
  /** Label text displayed above the input */
  label: string
  /** Hint text below the label (lighter, smaller) */
  hint?: string
  /** Error message shown below the input in red */
  error?: string
  /** Whether the field is required (shows indicator) */
  required?: boolean
  /** CSS class overrides */
  className?: string
  /** The input element — use the sub-components or pass custom children */
  children: ReactNode
}

/**
 * Wrapper component for form fields.
 * Renders label, hint, children (input), and error message.
 */
export function FormField({
  label,
  hint,
  error,
  required,
  className,
  children
}: FormFieldProps): React.ReactElement {
  return (
    <label className={`field${className ? ` ${className}` : ''}`}>
      <span>
        {label}
        {required && <span style={{ color: 'var(--color-danger)', marginInlineStart: 2 }}>*</span>}
      </span>
      {hint && (
        <span className="text-xs text-muted font-normal">
          {hint}
        </span>
      )}
      {children}
      {error && (
        <span
          style={{
            color: 'var(--color-danger)',
            fontSize: '0.78rem',
            fontWeight: 700,
            marginTop: 2
          }}
        >
          {error}
        </span>
      )}
    </label>
  )
}

/**
 * Checkbox variant of FormField using the `.field--checkbox` pattern.
 */
export function FormCheckbox({
  label,
  checked,
  onChange,
  disabled,
  hint
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  hint?: string
}): React.ReactElement {
  return (
    <label className="field--checkbox">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span className="font-semibold text-sm">{label}</span>
      {hint && (
        <span className="text-xs text-muted font-normal">
          {hint}
        </span>
      )}
    </label>
  )
}

// ── Convenience typed input components ──────────────────────────────────────

export type FormInputProps = InputHTMLAttributes<HTMLInputElement>
export type FormSelectProps = SelectHTMLAttributes<HTMLSelectElement>
export type FormTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>
