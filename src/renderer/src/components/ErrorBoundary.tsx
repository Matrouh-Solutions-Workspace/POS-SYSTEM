/**
 * REQ-13: React Error Boundary — catches render crashes in child trees.
 * Wraps lazy-loaded pages so a crash in one page doesn't take down the whole app.
 */
import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
  /** Optional custom fallback. Defaults to an Arabic error card. */
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  message: string
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error)
    return { hasError: true, message }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught render error:', error, info)
  }

  handleReset = (): void => {
    this.setState({ hasError: false, message: '' })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 300,
          padding: 40,
          textAlign: 'center',
          gap: 16
        }}>
          <div style={{ fontSize: '2.5rem' }}>⚠️</div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
            حدث خطأ غير متوقع
          </h2>
          <p style={{ color: 'var(--color-muted)', fontSize: '0.85rem', maxWidth: 400, margin: 0 }}>
            {this.state.message || 'يرجى المحاولة مرة أخرى أو إعادة تشغيل التطبيق'}
          </p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={this.handleReset}
          >
            حاول مجدداً
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
