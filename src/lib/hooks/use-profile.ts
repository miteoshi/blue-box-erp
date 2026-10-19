'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useOrgId } from '@/lib/hooks/use-tenant'
import type { Tables, Enums } from '@/lib/types/database'

export type Profile = Tables<'profiles'>
export type UserRole = Enums<'user_role'>

// Returns the current logged-in user's profile row.
// StaleTime is 0 so it always re-fetches on mount after a login/logout.
// The auth state listener below also invalidates it on any session change.
export function useProfile() {
  const supabase    = createClient()
  const queryClient = useQueryClient()
  const orgId = useOrgId()

  // ── Listen for auth state changes and immediately clear the cache ──
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        queryClient.removeQueries({ queryKey: ['profile'] })
        queryClient.removeQueries({ queryKey: ['tenant-context'] })
      } else if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        queryClient.invalidateQueries({ queryKey: ['profile'] })
        queryClient.invalidateQueries({ queryKey: ['tenant-context'] })
      }
    })
    return () => subscription.unsubscribe()
  }, [supabase, queryClient])

  return useQuery({
    queryKey: ['profile', orgId],
    queryFn: async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user || !orgId) return null

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()

      if (error) throw error
      return (data as Profile) ?? null
    },
    enabled: !!orgId,
    staleTime: 0,
  })
}

// Convenience hook — returns just the role
export function useRole(): UserRole | null {
  const { data } = useProfile()
  return data?.role ?? null
}

// Permission helpers
export function useCanApprove(): boolean {
  const role = useRole()
  return role === 'admin' || role === 'manager'
}

export function useCanWriteInventory(): boolean {
  const role = useRole()
  return role === 'admin' || role === 'store' || role === 'production'
}

export function useCanSell(): boolean {
  const role = useRole()
  return role === 'admin' || role === 'manager' || role === 'sales'
}

export function useIsAdmin(): boolean {
  return useRole() === 'admin'
}