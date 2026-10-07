import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ErrorBoundary from '../components/ErrorBoundary'

function Boom(): never {
  throw new Error('kaboom')
}

function silenceReactErrorLogs() {
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div>SAFE</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('SAFE')).toBeInTheDocument()
  })

  it('shows the luxury fallback with a reload action when a child throws', () => {
    silenceReactErrorLogs()
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'An unexpected error interrupted this screen. Reload to continue.',
    )
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.getByText('NEXARION SKY')).toBeInTheDocument()
    expect(screen.queryByText('SAFE')).not.toBeInTheDocument()
  })

  it('reports the error through componentDidCatch', () => {
    const spy = silenceReactErrorLogs()
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(spy).toHaveBeenCalledWith('Unhandled UI error:', expect.any(Error), expect.anything())
  })
})
