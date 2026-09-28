function required(key: string): string {
  const value = import.meta.env[key]
  if (!value || typeof value !== 'string') {
    throw new Error(`Missing required environment variable ${key}`)
  }
  return value
}

export const env = {
  supabaseUrl: required('VITE_SUPABASE_URL'),
  supabaseAnonKey: required('VITE_SUPABASE_ANON_KEY'),
  appEnv: (import.meta.env.VITE_APP_ENV as string | undefined) ?? 'development',
} as const

export type AppEnv = 'development' | 'staging' | 'production'

export function appEnv(): AppEnv {
  if (env.appEnv === 'staging' || env.appEnv === 'production') return env.appEnv
  return 'development'
}
