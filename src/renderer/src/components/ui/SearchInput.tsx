/**
 * SearchInput — debounced search input with clear button.
 */
import { useEffect, useRef, useState } from 'react'
import { MdSearch, MdClose } from 'react-icons/md'

export interface SearchInputProps {
  /** Current search value (controlled) */
  value: string
  /** Called when the debounced value changes */
  onChange: (value: string) => void
  /** Placeholder text */
  placeholder?: string
  /** Debounce delay in ms — defaults to 200 */
  debounceMs?: number
  /** Auto-focus on mount */
  autoFocus?: boolean
  /** CSS class name */
  className?: string
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'بحث...',
  debounceMs = 200,
  autoFocus,
  className
}: SearchInputProps): React.ReactElement {
  const [local, setLocal] = useState(value)
  const timerRef = useRef<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync external value changes
  useEffect(() => {
    setLocal(value)
  }, [value])

  function handleChange(v: string): void {
    setLocal(v)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => onChange(v), debounceMs)
  }

  function handleClear(): void {
    setLocal('')
    onChange('')
    inputRef.current?.focus()
  }

  return (
    <div className={`ui-search-input${className ? ` ${className}` : ''}`}>
      <MdSearch className="ui-search-input__icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        className="ui-search-input__input"
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      {local && (
        <button
          type="button"
          className="ui-search-input__clear"
          onClick={handleClear}
          aria-label="مسح البحث"
        >
          <MdClose />
        </button>
      )}
    </div>
  )
}
