/**
 * Badge — status/count badge component.
 */

export interface BadgeProps {
  /** Badge content (text or number) */
  children: React.ReactNode
  /** Badge variant */
  variant?: 'default' | 'primary' | 'danger' | 'success' | 'warning'
  /** Smaller size */
  size?: 'sm' | 'md'
}

export function Badge({
  children,
  variant = 'default',
  size = 'md'
}: BadgeProps): React.ReactElement {
  return (
    <span className={`ui-badge ui-badge--${variant} ui-badge--${size}`}>
      {children}
    </span>
  )
}
