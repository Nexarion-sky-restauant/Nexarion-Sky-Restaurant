import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { FullScreenLoading } from '../components/guards'

type Mode = 'signin' | 'signup' | 'reset'

export default function LoginPage() {
  const { session, loading, signUpEnabled, signInWithPassword, signUp, sendPasswordReset } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [mode, setMode] = useState<Mode>('signin')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!signUpEnabled && mode === 'signup') setMode('signin')
  }, [signUpEnabled, mode])

  if (loading) return <FullScreenLoading />
  if (session) return <Navigate to={from} replace />

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)

    if (mode === 'signin') {
      const { error } = await signInWithPassword(email, password)
      if (error) setError(error)
      else navigate(from, { replace: true })
    } else if (mode === 'signup') {
      const { error, emailSent } = await signUp(email, password, fullName)
      if (error) setError(error)
      else if (emailSent) {
        setMessage('Account created. Check your email to confirm, then sign in.')
        setMode('signin')
      } else navigate(from, { replace: true })
    } else {
      const { error } = await sendPasswordReset(email)
      if (error) setError(error)
      else setMessage('If an account exists for that email, a reset link is on its way.')
    }

    setBusy(false)
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">NS</div>
          <div>
            <div className="brand-name">NEXARION SKY</div>
            <div className="brand-sub">Restaurant ERP — sign in</div>
          </div>
        </div>

        {signUpEnabled && (
          <div className="auth-tabs">
            <button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>
              Sign in
            </button>
            <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
              Create account
            </button>
          </div>
        )}

        <form onSubmit={(e) => void onSubmit(e)} className="form">
          {mode === 'signup' && (
            <label className="field">
              <span>Full name</span>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required />
            </label>
          )}

          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>

          {mode !== 'reset' && (
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                minLength={8}
                required
              />
            </label>
          )}

          {error && <div className="alert alert-error">{error}</div>}
          {message && <div className="alert alert-info">{message}</div>}

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
          </button>
        </form>

        {mode !== 'reset' ? (
          <button type="button" className="link-button" onClick={() => { setMode('reset'); setError(null); setMessage(null) }}>
            Forgot your password?
          </button>
        ) : (
          <button type="button" className="link-button" onClick={() => { setMode('signin'); setError(null); setMessage(null) }}>
            Back to sign in
          </button>
        )}
      </div>
    </div>
  )
}
