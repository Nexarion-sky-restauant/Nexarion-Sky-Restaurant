import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/** Catches render-time crashes so the shell never dies to a blank screen (M3). */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-brand">
            <div className="brand-mark">NS</div>
            <div>
              <div className="brand-name">NEXARION SKY</div>
              <div className="brand-sub">Restaurant ERP</div>
            </div>
          </div>
          <h1>Something went wrong</h1>
          <div className="alert alert-error" role="alert">
            An unexpected error interrupted this screen. Reload to continue.
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
