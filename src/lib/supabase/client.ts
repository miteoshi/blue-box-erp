import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/types/database'

// Browser client — used in Client Components ('use client')
// Uses the anon key. RLS automatically applies based on the
// logged-in user's JWT token.
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}