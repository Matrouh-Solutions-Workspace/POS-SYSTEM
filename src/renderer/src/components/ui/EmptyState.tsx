/**
 * EmptyState — consistent empty content display with icon, message, and optional action.
 *
 * Used when a list, table, or section has no data to display.
 */
import type { ReactNode } from 'react'

export interface EmptyStateProps {
  /** Icon or emoji to display */
  icon?: ReactNode
  /** Main message (bold) */
  title: string
  /** Secondary description */
  description?: string
  /** Optional action button */
  action?: ReactNode
}

export function EmptyState({
  icon,
  title,
  description,
  action
}: EmptyStateProps): React.ReactElement {
  return (
    <div className="ui-empty-state">
      {icon && <div className="ui-empty-state__icon">{icon}</div>}
      <strong className="ui-empty-state__title">{title}</strong>
      {description && <span className="ui-empty-state__desc">{description}</span>}
      {action && <div className="ui-empty-state__action">{action}</div>}
    </div>
  )
}
