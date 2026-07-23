/**
 * FilterBar — horizontal filter strip for tables and lists.
 */
import type { ReactNode } from 'react'

export interface FilterBarProps {
  children: ReactNode
  className?: string
}

export function FilterBar({ children, className }: FilterBarProps): React.ReactElement {
  return (
    <div className={`ui-filter-bar${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  )
}

// ── Filter item sub-components ────────────────────────────────────────────

export interface FilterSelectProps {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  /** Whether to include a blank "all" option */
  allLabel?: string
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel
}: FilterSelectProps): React.ReactElement {
  return (
    <label className="ui-filter-bar__item">
      <span className="ui-filter-bar__label">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="ui-filter-bar__select"
      >
        {allLabel && <option value="">{allLabel}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export interface FilterDateProps {
  label: string
  value: string
  onChange: (value: string) => void
}

export function FilterDate({
  label,
  value,
  onChange
}: FilterDateProps): React.ReactElement {
  return (
    <label className="ui-filter-bar__item">
      <span className="ui-filter-bar__label">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="ui-filter-bar__input"
        dir="ltr"
      />
    </label>
  )
}
