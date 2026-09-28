import { createClient } from '@supabase/supabase-js'
import { env } from '../config/env'
import type { Database } from '../types/database'

// Browser client. Only the publishable anon key may ever appear here.
// All authorization is enforced by RLS; this client never bypasses it.
export const supabase = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
