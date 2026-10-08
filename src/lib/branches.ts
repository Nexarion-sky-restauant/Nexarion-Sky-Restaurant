import { supabase } from './supabase'
import type { Branch } from '../types/database'

export async function listBranches(): Promise<{ data: Branch[] | null; error: string | null }> {
  const { data, error } = await supabase
    .schema('app')
    .from('branches')
    .select('*')
    .eq('is_active', true)
    .order('name')

  if (error) return { data: null, error: error.message }
  return { data: data ?? [], error: null }
}

// Mirrors app.user_can_access_branch: no user_branches restriction rows means
// every branch of the organization is accessible.
export function filterAccessibleBranches(branches: Branch[], branchIds: string[]): Branch[] {
  if (branchIds.length === 0) return branches
  return branches.filter((branch) => branchIds.includes(branch.id))
}
