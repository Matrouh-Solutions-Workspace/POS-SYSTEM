/**
 * StatCard — stat display card component.
 *
 * Wraps the existing `.stat-card` CSS class.
 */
import type { ReactNode } from 'react'

export interface StatCardProps {
  /** Stat label (smaller text above the value) */
  label: string
  /** Stat value (large, bold) */
  value: ReactNode
  /** Optional border color override */
  borderColor?: string
  /** CSS class overrides */
  className?: string
}

export function StatCard({
  label,
  value,
  borderColor,
  className
}: StatCardProps): React.ReactElement {
  return (
    <div
      className={`stat-card${className ? ` ${className}` : ''}`}
      style={borderColor ? { borderColor } : undefined}
    >
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value">{value}</div>
    </div>
  )
}

/** Grid container for StatCard components */
export function StatGrid({
  children,
  className
}: {
  children: ReactNode
  className?: string
}): React.ReactElement {
  return (
    <div className={`stats-grid${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  )
}
