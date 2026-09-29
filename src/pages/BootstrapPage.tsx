import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { FullScreenLoading } from '../components/guards'
import { supabase } from '../lib/supabase'

/**
 * First-run flow: a signed-up user with no organization creates the business,
 * its first branch, and the four system roles (they become 'owner').
 * Driven by the app.bootstrap_organization RPC — see migration 00003.
 */
export default function BootstrapPage() {
  const { access, loading, refreshAccess } = useAuth()
  const navigate = useNavigate()

  const [orgName, setOrgName] = useState('Nexarion Sky Restaurant')
  const [orgSlug, setOrgSlug] = useState('nexarion-sky')
  const [branchName, setBranchName] = useState('Main Branch')
  const [branchCode, setBranchCode] = useState('MAIN')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading) return <FullScreenLoading />
  if (access?.organization) return <Navigate to="/" replace />

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const { error } = await supabase.schema('app').rpc('bootstrap_organization', {
      p_org_name: orgName.trim(),
      p_org_slug: orgSlug.trim().toLowerCase(),
      p_branch_name: branchName.trim(),
      p_branch_code: branchCode.trim().toUpperCase(),
    })

    if (error) {
      setError(error.message)
      setBusy(false)
      return
    }

    await refreshAccess()
    navigate('/', { replace: true })
  }

  return (
    <div className="auth-screen">
      <div className="auth-card auth-card-wide">
        <div className="auth-brand">
          <div className="brand-mark">NS</div>
          <div>
            <div className="brand-name">Set up your business</div>
            <div className="brand-sub">One organization, one central database, many departments.</div>
          </div>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="form">
          <label className="field">
            <span>Business name</span>
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
          </label>

          <label className="field">
            <span>Business slug (unique, lowercase)</span>
            <input value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)} pattern="[a-z0-9-]+" required />
          </label>

          <div className="field-row">
            <label className="field">
              <span>First branch name</span>
              <input value={branchName} onChange={(e) => setBranchName(e.target.value)} required />
            </label>
            <label className="field field-narrow">
              <span>Branch code</span>
              <input value={branchCode} onChange={(e) => setBranchCode(e.target.value)} required />
            </label>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create organization'}
          </button>
        </form>
      </div>
    </div>
  )
}
