import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Next.js 16 "proxy" (formerly middleware) — runs on every request.
// It refreshes the Supabase session and redirects
// unauthenticated users to /login.
export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    // Run on all routes EXCEPT:
    // - _next/static (static files)
    // - _next/image (image optimization)
    // - favicon.ico
    // - public folder files
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}