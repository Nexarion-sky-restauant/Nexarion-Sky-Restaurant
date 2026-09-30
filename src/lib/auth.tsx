import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { AccessPayload } from '../types/database'

interface AuthContextValue {
  session: Session | null
  /** True while the initial session/access load is in flight. */
  loading: boolean
  /** Null when the signed-in user has not joined an organization yet. */
  access: AccessPayload | null
  hasPermission: (key: string) => boolean
  refreshAccess: () => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null; emailSent: boolean }>
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function friendlyError(message: string): string {
  // Supabase returns readable English messages; keep them but trim noise.
  return message.replace(/^[^:]*:/, '').trim() || 'Something went wrong. Please try again.'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [access, setAccess] = useState<AccessPayload | null>(null)
  const [loading, setLoading] = useState(true)

  const loadAccess = useCallback(async () => {
    const { data, error } = await supabase.schema('app').rpc('get_my_access')
    if (error) {
      // A fresh function deployment can lag; treat as not-yet-bootstrapped.
      setAccess({ profile: null, organization: null, permissions: [], branch_ids: [] })
      return
    }
    const payload = data as unknown as AccessPayload
    setAccess(payload.profile ? payload : null)
  }, [])

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      if (data.session) {
        void loadAccess().finally(() => !cancelled && setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (nextSession) {
        void loadAccess()
      } else {
        setAccess(null)
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [loadAccess])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      access,
      hasPermission: (key) => access?.permissions.includes(key) ?? false,
      refreshAccess: loadAccess,
      signInWithPassword: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        return { error: error ? friendlyError(error.message) : null }
      },
      signUp: async (email, password, fullName) => {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        })
        if (error) return { error: friendlyError(error.message), emailSent: false }
        // Email confirmation enabled → no session yet; the user must confirm.
        return { error: null, emailSent: data.session === null }
      },
      sendPasswordReset: async (email) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email)
        return { error: error ? friendlyError(error.message) : null }
      },
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }),
    [session, loading, access, loadAccess],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
