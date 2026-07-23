/**
 * LoadingSpinner — consistent loading indicator.
 */

export interface LoadingSpinnerProps {
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Optional label text */
  label?: string
}

export function LoadingSpinner({
  size = 'md',
  label
}: LoadingSpinnerProps): React.ReactElement {
  const sizeMap = { sm: 20, md: 32, lg: 48 }
  const px = sizeMap[size]

  return (
    <div className="ui-loading-spinner" aria-busy="true" aria-label={label ?? 'جارٍ التحميل'}>
      <svg
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        className="ui-loading-spinner__svg"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="var(--color-border-light)"
          strokeWidth="3"
        />
        <path
          d="M12 2a10 10 0 0 1 10 10"
          stroke="var(--color-primary)"
          strokeWidth="3"
          strokeLinecap="square"
        />
      </svg>
      {label && <span className="ui-loading-spinner__label">{label}</span>}
    </div>
  )
}
